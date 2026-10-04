CREATE TABLE IF NOT EXISTS candidate_answer_memory (
 memory_id uuid PRIMARY KEY, candidate_profile_id text NOT NULL,
 semantic_key text NOT NULL, scope_json jsonb NOT NULL,
 answer_json jsonb NOT NULL, question_id uuid REFERENCES application_questions,
 source text NOT NULL CHECK(source IN ('USER_DASHBOARD','USER_TELEGRAM','USER_CHAT')),
 version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_profile_id,semantic_key,scope_json)
);
