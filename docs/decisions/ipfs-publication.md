# Decision Record — Deferral of PII Publication to Public IPFS

**Status:** Adopted for this deliverable
**Scope:** Public IPFS/IPNS publication of property-owner personally identifiable information (PII)

## 1. Context

The ingestion pipeline produces per-property artifacts — a columnar query table and per-property
open-data JSON — that include property-owner PII, specifically owner names and mailing/situs
addresses. The reference publication flow uploads these artifacts to public IPFS (via Filebase)
behind an IPNS pointer, subject to a human-executed upload step.

## 2. Decision

The pipeline is implemented and validated end-to-end through the publication step, executed in
dry-run mode: the export produces each artifact and its content identifier (CID), the validation
gate passes, and the MCP is wired to the resulting IPNS. No owner PII is uploaded to public IPFS.
The complete dataset is served exclusively from the authenticated hosted query layer; the public,
decentralized layer is delivered in a publication-ready state and is not populated with PII.

## 3. Rationale

**3.1 Statutory address exemptions.** Florida law exempts the home addresses and related identifiers
of specified individuals from public-records disclosure. Fla. Stat. §119.071(4)(d) exempts the home
addresses, telephone numbers, and related information of active and former law-enforcement personnel,
correctional officers, firefighters, prosecutors, and judicial officers (including general and
special magistrates and administrative law judges), together with those of their spouses and
children. Separately, the Address Confidentiality Program for Victims of Domestic Violence, Fla.
Stat. §§741.401–741.409, permits participants to use a substitute address, and Fla. Stat. §741.465
exempts participants' actual addresses from disclosure. The statewide Department of Revenue tax roll
applies these exemptions at source; a raw county-appraiser dataset does not, and this pipeline
contains no per-record exemption filter. A bulk publication would therefore risk disclosing the
addresses of statutorily protected individuals.

**3.2 Erasure cannot be guaranteed.** IPFS is not permanent storage: content remains available only
while a node pins it, and unpinning followed by garbage collection removes the operator's copy, while
public-gateway caches expire over time. Erasure nonetheless cannot be guaranteed — under content
addressing, a third party may independently re-pin the identical content under its deterministic CID,
and the probability of such re-pinning is not reliably quantifiable. A non-zero and imperfectly
reversible persistence risk to third-party PII, outside the operator's control, is itself sufficient
grounds to defer publication absent necessity; certainty of permanence is not a precondition for the
risk to be material.

**3.3 Aggregation and practical obscurity.** Individual public records carry a privacy expectation
grounded in practical obscurity. Aggregating an entire county's owner names and addresses into a
single, downloadable artifact on permanent-by-default public storage materially alters that
expectation, independent of the status of any individual record.

**3.4 Data minimization.** There is no operational necessity to expose real owner PII on a public
decentralized network to demonstrate the platform. The required intelligence workflows are answered
from the authenticated hosted layer over the same underlying data.

## 4. Delivered scope

- Full ingestion into canonical, provenance-tracked entities in the hosted query layer, at realistic
  record scale.
- An exploration UI and a retrieval-grounded agent answering the required inquiry workflows over real
  records, behind authentication.
- The IPFS / DuckDB / MCP publication path, built and dry-run validated (artifact, CID, and MCP
  wiring).

## 5. Consequence for the deployed MCP

The MCP server is deployed and wired to the county's IPNS pointers to demonstrate MCP-readiness, and
its behaviour reflects the scope of this decision precisely.

- **Dataset coverage (non-PII) is published.** The dataset-coverage artifact is aggregate metadata —
  per-source record counts and coverage, with no owner-level PII — and is published to public IPFS.
  The MCP's dataset-information tool (`getOracleDatasetInfo`) therefore returns the county's real
  coverage: the dataset is present, described, and quantified.
- **The per-property query table (PII) is deferred.** Because the owner-level artifact is
  intentionally not published (Section 2), the MCP's property-query tool (`queryProperties`) returns
  no rows for this county. This is the expected result of the publication deferral, not a defect.

The complete owner-level data is served in full from the authenticated hosted layer (the exploration
UI and the agent), which is the intended interface for exercising the platform. The property-query
path over the MCP begins serving rows once a redacted, eligible artifact is published under the
conditions in Section 6.

## 6. Conditions for publication

Publication becomes appropriate once (a) a per-record exemption filter (§119.071(4)(d); §741.465) is
applied, (b) owner PII is redacted to an eligible, non-identifying subset, and (c) a documented
lawful basis and authorization are in place. The same pipeline then publishes the redacted, eligible
artifact.

## 7. Note

This record is an engineering risk assessment and does not constitute legal advice.
