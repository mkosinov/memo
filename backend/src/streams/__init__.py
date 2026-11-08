"""Generic Redis Streams transport (GH #580 §3.6).

The shared streams core ``src/streams/transport.py`` lives here — the
mechanics extracted from notify's queue adapter (GH #483, ADR 013) so
``src/domain_events`` (#580) reuses them without importing notify. The
package knows no stream names and no notify vocabulary.
"""
