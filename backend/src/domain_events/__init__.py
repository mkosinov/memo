"""Domain events module (#580, spec §3.1): journal + type registry.

The PRODUCER seam of the domain-events service: ``@transactional``
inserts staged event rows into the same transaction as the domain
change (``journal``), and the declarative type registry (``types``)
validates every mark. The relay (``relay``) and the public subscription
API (``subscribe``) arrive with later plan tasks (#580 Tasks 4-5).

Import direction (domain rules): this package never imports notify;
notify imports it (transitional re-export of ``DomainEvent`` until the
dispatcher switches to the group loop, Task 6).
"""
