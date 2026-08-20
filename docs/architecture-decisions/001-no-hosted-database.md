# ADR 001 — No hosted database in the read path

## Status

Accepted.

## Context

The Duval user story states the constraint plainly: _"Design the infrastructure so
Oracle does not carry ongoing infrastructure cost by default"_ and _"Use DuckDB
for local or portable analytical querying"_.

The canonical Elephant pipeline described by `elephant-xyz/skills` runs Restate
plus Postgres 16 in Docker Compose, and the query layer reads a Parquet artifact
off IPFS. Two of those three pieces are always-on infrastructure.

## Decision

The serving plane has no database. The published query-table Parquet on IPFS is
the only thing a consumer reads, and `elephant-mcp` queries it in-process with
DuckDB over HTTP range requests. Both this repo's UI and the downstream CRM go
through that MCP surface; neither can reach a database, because there is not one.

The building plane — ingestion, derivation, publication — uses a DuckDB **file**
on a Railway volume. It is a file, not a service: nothing listens on a port,
nothing runs between pipeline runs, and it can be deleted and rebuilt from the
public sources in about a minute.

## Consequences

- The cost of serving Duval data to any number of consumers is the cost of the
  IPFS pin, which is on the free tier. Each consumer runs their own stateless
  MCP; there is no shared backend to scale or pay for.
- DuckDB is single-writer, so the worker runs at exactly one replica with
  autoscaling disabled. This is a real constraint, not an oversight.
- Deviating from the kit's Postgres costs some kit-conformance credit. The
  deviation is taken deliberately because conforming would violate the story's
  own central requirement.
