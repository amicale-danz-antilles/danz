-- Données entièrement fictives, format texte PostgreSQL COPY.
-- Les références différées permettent d'exercer le chargement hors ordre.

COPY public.treasury_transfers (id, from_account, to_account, amount_cents) FROM stdin;
FICT-transfer	bank	cash	1000
\.

COPY public.treasury_opening (id, bank_cents, cash_cents) FROM stdin;
1	10000	-200
\.

COPY public.treasury_import_batches (id) FROM stdin;
FICT-archive
\.

COPY public.treasury_import_archive_lines (batch_id, source_row, income_cents, expense_cents) FROM stdin;
FICT-archive	1	1500	\N
FICT-archive	2	\N	200
\.

COPY public.treasury_event_participants (id) FROM stdin;
FICT-treasury_event_participants
\.

COPY public.treasury_event_batches (id) FROM stdin;
FICT-treasury_event_batches
\.

COPY public.treasury_entries (id, kind, status, payment_method, amount_cents, household_payment_id) FROM stdin;
FICT-income	income	settled	bank_transfer	1500	FICT-payment
FICT-expense	expense	settled	cash	200	\N
FICT-pending	income	pending	cash	399	\N
FICT-cancelled	expense	cancelled	cash	400	\N
FICT-unassigned	income	settled	unassigned	400	\N
\.

COPY public.push_subscriptions (id) FROM stdin;
\.

COPY public.profiles (id, note, active, is_treasurer) FROM stdin;
FICT-member	\N	t	f
FICT-admin	\\N	t	t
FICT-inactive		f	f
\.

COPY public.polls (id) FROM stdin;
FICT-poll
\.

COPY public.poll_votes (poll_id, user_id, option_id) FROM stdin;
FICT-poll	FICT-member	FICT-option
FICT-poll	FICT-admin	FICT-option
\.

COPY public.poll_questions (id, poll_id) FROM stdin;
FICT-question	FICT-poll
\.

COPY public.poll_question_answers (question_id, user_id, answer) FROM stdin;
FICT-question	FICT-member	Ligne 1\nLigne 2\tFin
\.

COPY public.poll_options (id, poll_id) FROM stdin;
FICT-option	FICT-poll
\.

COPY public.poll_household_attendance (poll_id, household_member_id) FROM stdin;
FICT-poll	FICT-household-member
FICT-poll	FICT-child
\.

COPY public.offline_people (id) FROM stdin;
\.

COPY public.notification_settings (id) FROM stdin;
FICT-notification_settings
\.

COPY public.notification_preferences (user_id) FROM stdin;
FICT-member
\.

COPY public.news (id) FROM stdin;
FICT-news
\.

COPY public.membership_subscriptions (id, household_id, amount_cents) FROM stdin;
FICT-subscription	FICT-household	1500
\.

COPY public.membership_requests (id) FROM stdin;
FICT-membership_requests
\.

COPY public.households (id, name) FROM stdin;
FICT-household	Foyer fictif
\.

COPY public.household_payments (id, household_id, amount_cents) FROM stdin;
FICT-payment	FICT-household	1500
\.

COPY public.household_payment_allocations (payment_id, charge_id, amount_cents) FROM stdin;
FICT-payment	FICT-charge	1500
\.

COPY public.household_members (id, household_id, user_id) FROM stdin;
FICT-household-member	FICT-household	FICT-member
FICT-child	FICT-household	\N
\.

COPY public.household_charges (id, household_id, amount_cents) FROM stdin;
FICT-charge	FICT-household	1500
\.

COPY public.good_deals (id) FROM stdin;
FICT-good_deals
\.

COPY public.good_deal_submissions (id) FROM stdin;
FICT-good_deal_submissions
\.

COPY public.gallery (id) FROM stdin;
\.

COPY public.events (id, title) FROM stdin;
FICT-event	Événement du test
\.

COPY public.event_albums (id) FROM stdin;
FICT-event_albums
\.

COPY public.documents (id) FROM stdin;
FICT-documents
\.

COPY public.content_attachments (id) FROM stdin;
FICT-content_attachments
\.

COPY public.bureau_members (role_key) FROM stdin;
FICT-bureau_members
\.

COPY public.association_settings (id) FROM stdin;
1
\.

COPY public.admin_audit_log (id) FROM stdin;
FICT-admin_audit_log
\.
