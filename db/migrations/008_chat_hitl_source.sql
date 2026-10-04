-- Trusted local chat answers retain their real provenance. Public HTTP answer
-- endpoints continue assigning fixed sources instead of accepting caller input.
ALTER TABLE application_answer_receipts
 DROP CONSTRAINT IF EXISTS application_answer_receipts_source_check;
ALTER TABLE application_answer_receipts
 ADD CONSTRAINT application_answer_receipts_source_check
 CHECK(source IN ('USER_DASHBOARD','USER_TELEGRAM','USER_CHAT'));
