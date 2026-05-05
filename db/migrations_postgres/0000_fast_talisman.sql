CREATE TYPE "public"."dialogue_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'apple', 'telegram');--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"twin_profile_id" uuid,
	"body" text,
	"idempotency_key" text,
	"embedding_json" jsonb,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"provider" "oauth_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"code_verifier" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"twin_profile_id" uuid NOT NULL,
	"scenario_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"idempotency_key" text,
	"embedding_json" jsonb,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twin_dialogue_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"twin_profile_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" "dialogue_role" NOT NULL,
	"content" text NOT NULL,
	"idempotency_key" text,
	"embedding_json" jsonb,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twin_prediction_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"twin_profile_id" uuid NOT NULL,
	"prediction_id" text,
	"scenario" text NOT NULL,
	"verification" text NOT NULL,
	"correction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twin_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twin_readiness_state" (
	"twin_profile_id" uuid PRIMARY KEY NOT NULL,
	"indicators_json" jsonb NOT NULL,
	"socialization_completed" boolean NOT NULL,
	"final_state_message_shown" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twin_repeatability_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"twin_profile_id" uuid NOT NULL,
	"scenario_hash" text NOT NULL,
	"pattern_type" text NOT NULL,
	"prediction_outcome" text NOT NULL,
	"verification_result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_label" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"twin_profile_id" uuid NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_answers" ADD CONSTRAINT "scenario_answers_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_dialogue_turns" ADD CONSTRAINT "twin_dialogue_turns_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_prediction_verifications" ADD CONSTRAINT "twin_prediction_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_prediction_verifications" ADD CONSTRAINT "twin_prediction_verifications_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_profiles" ADD CONSTRAINT "twin_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_readiness_state" ADD CONSTRAINT "twin_readiness_state_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_repeatability_records" ADD CONSTRAINT "twin_repeatability_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_repeatability_records" ADD CONSTRAINT "twin_repeatability_records_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_feedback" ADD CONSTRAINT "verification_feedback_twin_profile_id_twin_profiles_id_fk" FOREIGN KEY ("twin_profile_id") REFERENCES "public"."twin_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_entries_user_created_idx" ON "diary_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_subject_unique" ON "oauth_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "scenario_answers_profile_created_idx" ON "scenario_answers" USING btree ("twin_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "twin_dialogue_turns_idempotency_key_unique" ON "twin_dialogue_turns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "twin_dialogue_turns_twin_seq_idx" ON "twin_dialogue_turns" USING btree ("twin_profile_id","sequence");--> statement-breakpoint
CREATE INDEX "twin_prediction_verifications_user_created_idx" ON "twin_prediction_verifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "twin_prediction_verifications_profile_created_idx" ON "twin_prediction_verifications" USING btree ("twin_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "twin_profiles_user_id_unique" ON "twin_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twin_repeatability_records_user_created_idx" ON "twin_repeatability_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "twin_repeatability_records_scenario_hash_idx" ON "twin_repeatability_records" USING btree ("scenario_hash");--> statement-breakpoint
CREATE INDEX "twin_repeatability_records_pattern_type_idx" ON "twin_repeatability_records" USING btree ("pattern_type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");