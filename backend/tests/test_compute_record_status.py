"""Unit tests for compute_record_status derivation function."""
import pytest
from src.domain.visit_status import VisitStatus, VisitItem, compute_record_status


@pytest.mark.parametrize(
    "visits,expected",
    [
        # 0 visits
        ([], VisitStatus.WAITING),
        # 1 visit each status
        ([VisitItem(id="v1", status=VisitStatus.WAITING)], VisitStatus.WAITING),
        ([VisitItem(id="v1", status=VisitStatus.VISITED)], VisitStatus.VISITED),
        ([VisitItem(id="v1", status=VisitStatus.MISSED)], VisitStatus.MISSED),
        ([VisitItem(id="v1", status=VisitStatus.CANCELLED)], VisitStatus.CANCELLED),
        # Mixed: any visited wins
        ([
            VisitItem(id="v1", status=VisitStatus.VISITED),
            VisitItem(id="v2", status=VisitStatus.WAITING),
        ], VisitStatus.VISITED),
        # All missed
        ([
            VisitItem(id="v1", status=VisitStatus.MISSED),
            VisitItem(id="v2", status=VisitStatus.MISSED),
        ], VisitStatus.MISSED),
        # All cancelled
        ([
            VisitItem(id="v1", status=VisitStatus.CANCELLED),
            VisitItem(id="v2", status=VisitStatus.CANCELLED),
        ], VisitStatus.CANCELLED),
        # Mixed missed + waiting → waiting
        ([
            VisitItem(id="v1", status=VisitStatus.MISSED),
            VisitItem(id="v2", status=VisitStatus.WAITING),
        ], VisitStatus.WAITING),
    ],
)
def test_compute_record_status(visits, expected):
    assert compute_record_status(visits) == expected
