"""FastAPI router for the users API vertical (GH #348 Task 4, spec §5/§7).

Transport-only file: both endpoints are thin wrappers over the Task 2-3
scenarios (Corridor 2 of the service canon — the business actions live
in ``usecases/``, each in ONE transaction):

* ``PATCH /api/v1/users/{id}`` — the admin-side phone edit (S5) →
  :func:`src.usecases.user.update_user_phone`; strict ``{phone}`` body
  (``UserPhonePatch`` — extra keys → 422); domain errors map to their
  §5 codes (``PHONE_TAKEN`` / ``PHONE_INVALID``); unknown id → 404
  ``USER_NOT_FOUND``; success → the account projection
  (``UserAccountResponse``).
* ``POST /api/v1/users/{id}/password-link`` — issue a one-time setup
  link (S3/S7) → :func:`src.usecases.password_setup.issue_password_link`;
  archived account → 422 ``ACCOUNT_DEACTIVATED``; unknown id → 404;
  success → ``{token, expires_at}`` — the RAW token surfaces exactly
  once, here (only its SHA-256 digest is persisted).

Access (spec §7): both routes under ``require_admin`` — a master must
not reach other accounts' phones or links (403), and the master's own
phone stays an admin-side edit as today. ``require_admin`` wraps
``require_session``, so the default-deny contract (GH #247 §2.6) sees
the auth dependency and no ``PUBLIC_ROUTES`` entry is needed.
"""

from fastapi import APIRouter, Depends, HTTPException

from src.auth.permissions import require_admin
from src.db import SessionDep
from src.domain.errors import PhoneInvalidError, PhoneTakenError
from src.errors import ErrorCode, ErrorDetail
from src.schemas.user import (
    PasswordLinkResponse,
    UserAccountResponse,
    UserPhonePatch,
)
from src.usecases.password_setup import (
    AccountDeactivatedError,
    issue_password_link,
)
from src.usecases.user import update_user_phone

router = APIRouter(
    tags=["users"],
    # GH #348 spec §7: both operations are admin-only (require_admin
    # wraps require_session — the default-deny contract sees it).
    dependencies=[Depends(require_admin)],
)


def _user_not_found() -> HTTPException:
    """404 — the addressed account does not exist."""
    return HTTPException(
        status_code=404,
        detail=ErrorDetail(
            code=ErrorCode.USER_NOT_FOUND,
            message="Учётка не найдена",
        ).model_dump(),
    )


def _domain_error(code: ErrorCode, message: str) -> HTTPException:
    """Domain error → its 422 ErrorDetail (spec §5 error contracts)."""
    return HTTPException(
        status_code=422,
        detail=ErrorDetail(code=code, message=message).model_dump(),
    )


@router.patch("/{user_id}", response_model=UserAccountResponse)
async def patch_user(
    user_id: str,
    data: UserPhonePatch,
    session: SessionDep,
) -> UserAccountResponse:
    """Edit an account's phone (S5) — admin-only, strict ``{phone}`` body.

    The scenario validates via the SHARED domain validator
    (``PHONE_INVALID``), probes exact-string uniqueness (``PHONE_TAKEN``),
    journals the masked diff and skips a same-string no-op. Sessions are
    NOT revoked (cookie sessions are not tied to the phone).

    Selfless-scenario convention (``usecases/records.py``): the leading
    ``None`` fills the ``@transactional`` wrapper's unused ``self`` slot.
    """
    try:
        user = await update_user_phone(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            user_id=user_id,
            phone=data.phone,
        )
    except PhoneTakenError as exc:
        raise _domain_error(ErrorCode.PHONE_TAKEN, str(exc)) from exc
    except PhoneInvalidError as exc:
        raise _domain_error(ErrorCode.PHONE_INVALID, str(exc)) from exc
    if user is None:
        raise _user_not_found()
    return UserAccountResponse.model_validate(user)


@router.post("/{user_id}/password-link", response_model=PasswordLinkResponse)
async def issue_link(
    user_id: str,
    session: SessionDep,
) -> PasswordLinkResponse:
    """Issue a one-time password-setup link (S3/S7) — admin-only.

    The scenario sweeps every former token of the account, inserts the
    fresh live one (raw token → SHA-256 digest; one live token per
    account is a DB-level partial-unique guarantee) and journals
    ``password_link_issued`` — one transaction. The raw token returns
    EXACTLY here, once; the frontend builds the handover URL from the
    page origin (``{origin}/password-setup#token=…``, spec §5).
    """
    try:
        link = await issue_password_link(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            user_id=user_id,
        )
    except AccountDeactivatedError as exc:
        raise _domain_error(ErrorCode.ACCOUNT_DEACTIVATED, "Учётка деактивирована") from exc
    if link is None:
        raise _user_not_found()
    return PasswordLinkResponse(token=link.raw_token, expires_at=link.expires_at)
