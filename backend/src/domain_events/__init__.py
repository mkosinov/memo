"""Domain events module (#580, spec §3.1): journal + type registry.

The PRODUCER seam of the domain-events service: ``@transactional``
inserts staged event rows into the same transaction as the domain
change (``journal``), and the declarative type registry (``types``)
validates every mark. The relay (``relay`` — the journal→stream
process, #580 Task 4) and the public subscription API (``subscribe`` —
:class:`src.domain_events.subscribe.Subscriber`, #580 Task 5) are live.

Import direction (domain rules): this package never imports notify;
notify imports it — the subscriber API and the type registry are the
consumer-side seam (the transitional ``DomainEvent`` re-export in notify
died with the dispatcher's switchover to the group loop, Task 6).
"""
