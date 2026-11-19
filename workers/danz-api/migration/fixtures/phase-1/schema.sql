-- Jeu entièrement fictif et volontairement abrégé pour la répétition locale.
-- À charger dans un cluster PostgreSQL jetable et vide.

CREATE TABLE public.admin_audit_log (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.association_settings (id integer NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.bureau_members (role_key text NOT NULL, PRIMARY KEY (role_key));
CREATE TABLE public.content_attachments (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.documents (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.event_albums (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.events (id text NOT NULL, title text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.gallery (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.good_deal_submissions (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.good_deals (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.household_charges (id text NOT NULL, household_id text NOT NULL, amount_cents integer NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.household_members (id text NOT NULL, household_id text NOT NULL, user_id text, PRIMARY KEY (id));
CREATE TABLE public.household_payment_allocations (payment_id text NOT NULL, charge_id text NOT NULL, amount_cents integer NOT NULL, PRIMARY KEY (payment_id, charge_id));
CREATE TABLE public.household_payments (id text NOT NULL, household_id text NOT NULL, amount_cents integer NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.households (id text NOT NULL, name text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.membership_requests (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.membership_subscriptions (id text NOT NULL, household_id text NOT NULL, amount_cents integer NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.news (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.notification_preferences (user_id text NOT NULL, PRIMARY KEY (user_id));
CREATE TABLE public.notification_settings (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.offline_people (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.poll_household_attendance (poll_id text NOT NULL, household_member_id text NOT NULL, PRIMARY KEY (poll_id, household_member_id));
CREATE TABLE public.poll_options (id text NOT NULL, poll_id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.poll_question_answers (question_id text NOT NULL, user_id text NOT NULL, answer text NOT NULL, PRIMARY KEY (question_id, user_id));
CREATE TABLE public.poll_questions (id text NOT NULL, poll_id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.poll_votes (poll_id text NOT NULL, user_id text NOT NULL, option_id text NOT NULL, PRIMARY KEY (poll_id, user_id));
CREATE TABLE public.polls (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.profiles (id text NOT NULL, active boolean NOT NULL, is_treasurer boolean NOT NULL, note text, PRIMARY KEY (id));
CREATE TABLE public.push_subscriptions (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.treasury_entries (id text NOT NULL, kind text NOT NULL, status text NOT NULL, payment_method text NOT NULL, amount_cents integer NOT NULL, household_payment_id text, PRIMARY KEY (id));
CREATE TABLE public.treasury_event_batches (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.treasury_event_participants (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.treasury_import_archive_lines (batch_id text NOT NULL, source_row integer NOT NULL, income_cents integer, expense_cents integer, PRIMARY KEY (batch_id, source_row));
CREATE TABLE public.treasury_import_batches (id text NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.treasury_opening (id integer NOT NULL, bank_cents bigint NOT NULL, cash_cents bigint NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.treasury_transfers (id text NOT NULL, from_account text NOT NULL, to_account text NOT NULL, amount_cents integer NOT NULL, PRIMARY KEY (id));

ALTER TABLE ONLY public.household_charges ADD FOREIGN KEY (household_id)
    REFERENCES public.households (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.household_members ADD FOREIGN KEY (household_id)
    REFERENCES public.households (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.household_members ADD FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.household_payment_allocations ADD FOREIGN KEY (payment_id)
    REFERENCES public.household_payments (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.household_payment_allocations ADD FOREIGN KEY (charge_id)
    REFERENCES public.household_charges (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.household_payments ADD FOREIGN KEY (household_id)
    REFERENCES public.households (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.membership_subscriptions ADD FOREIGN KEY (household_id)
    REFERENCES public.households (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.notification_preferences ADD FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_household_attendance ADD FOREIGN KEY (poll_id)
    REFERENCES public.polls (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_household_attendance ADD FOREIGN KEY (household_member_id)
    REFERENCES public.household_members (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_options ADD FOREIGN KEY (poll_id)
    REFERENCES public.polls (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_question_answers ADD FOREIGN KEY (question_id)
    REFERENCES public.poll_questions (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_question_answers ADD FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_questions ADD FOREIGN KEY (poll_id)
    REFERENCES public.polls (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_votes ADD FOREIGN KEY (poll_id)
    REFERENCES public.polls (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_votes ADD FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.poll_votes ADD FOREIGN KEY (option_id)
    REFERENCES public.poll_options (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.treasury_entries ADD FOREIGN KEY (household_payment_id)
    REFERENCES public.household_payments (id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.treasury_import_archive_lines ADD FOREIGN KEY (batch_id)
    REFERENCES public.treasury_import_batches (id) DEFERRABLE INITIALLY DEFERRED;
