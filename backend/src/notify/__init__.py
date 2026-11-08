"""Notify subsystem (#482 / family #476): delivery tasks, templates,
queue port, dispatcher.

#580 Task 2: the domain-event journal (accumulator + ``DomainEvent``
model) moved to ``src/domain_events`` (re-exported from
``src.notify.models`` until the dispatcher switches to the consumer-
group loop, Task 6); the ``new_record`` snapshot builder moved to the
producer (``src/usecases/record_snapshots.py``).
"""
