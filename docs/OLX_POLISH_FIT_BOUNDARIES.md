# OLX qualification section regression

The initial local model examples exposed an input catalog defect: observed plain JSON-LD descriptions used Polish headings absent from the bounded section vocabulary. Both actual sources produced zero deterministic mandatory anchors. Consequently, one model response omitted qualifications and another treated an offer heading as a candidate requirement.

`fit-analysis-v3.2-polish-boundaries` recognizes standalone `Czego oczekujemy?`, `Oczekujemy`, `Oferujemy`, `Organizacja pracy`, responsibilities and related bounded Polish headings. Requirement scopes stop at offer/work organisation/responsibility sections. Headings are context-only and cannot be selected as scored requirements. Words embedded in normal employer prose do not trigger section scope.

The tokenizer preserves Polish licence abbreviations `gr. 1` and `kat. B`, numeric licence group enumerations and a preferred specialization within the original clause. Candidate quotations remain exact and contiguous.

Read-only verification against stored source descriptions produces seven atomic mandatory fragments for job `221e87ec-35c0-5009-9cb1-8f4205b4f06a` and five for `5924fd0d-762b-5e90-86a9-b52ac31db65c`. The fixture records the observed qualification text without applicant data. Historical analyses remain unchanged; the prompt version changes new input receipt hashes. This regression verification does not establish a new live model fit result; rerun the examples with the updated version.
