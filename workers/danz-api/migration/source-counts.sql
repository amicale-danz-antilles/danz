-- Lecture seule : nombre de lignes par table publique Supabase. Aucun contenu renvoye.
-- Ce rapport constitue une PHOTO temporaire, a renouveler au moment de migration.
SELECT 'admin_audit_log' AS table_name, COUNT(*)::bigint AS row_count FROM public.admin_audit_log
UNION ALL
SELECT 'association_settings' AS table_name, COUNT(*)::bigint AS row_count FROM public.association_settings
UNION ALL
SELECT 'bureau_members' AS table_name, COUNT(*)::bigint AS row_count FROM public.bureau_members
UNION ALL
SELECT 'content_attachments' AS table_name, COUNT(*)::bigint AS row_count FROM public.content_attachments
UNION ALL
SELECT 'documents' AS table_name, COUNT(*)::bigint AS row_count FROM public.documents
UNION ALL
SELECT 'event_albums' AS table_name, COUNT(*)::bigint AS row_count FROM public.event_albums
UNION ALL
SELECT 'events' AS table_name, COUNT(*)::bigint AS row_count FROM public.events
UNION ALL
SELECT 'gallery' AS table_name, COUNT(*)::bigint AS row_count FROM public.gallery
UNION ALL
SELECT 'good_deal_submissions' AS table_name, COUNT(*)::bigint AS row_count FROM public.good_deal_submissions
UNION ALL
SELECT 'good_deals' AS table_name, COUNT(*)::bigint AS row_count FROM public.good_deals
UNION ALL
SELECT 'household_charges' AS table_name, COUNT(*)::bigint AS row_count FROM public.household_charges
UNION ALL
SELECT 'household_members' AS table_name, COUNT(*)::bigint AS row_count FROM public.household_members
UNION ALL
SELECT 'household_payment_allocations' AS table_name, COUNT(*)::bigint AS row_count FROM public.household_payment_allocations
UNION ALL
SELECT 'household_payments' AS table_name, COUNT(*)::bigint AS row_count FROM public.household_payments
UNION ALL
SELECT 'households' AS table_name, COUNT(*)::bigint AS row_count FROM public.households
UNION ALL
SELECT 'membership_requests' AS table_name, COUNT(*)::bigint AS row_count FROM public.membership_requests
UNION ALL
SELECT 'membership_subscriptions' AS table_name, COUNT(*)::bigint AS row_count FROM public.membership_subscriptions
UNION ALL
SELECT 'news' AS table_name, COUNT(*)::bigint AS row_count FROM public.news
UNION ALL
SELECT 'notification_preferences' AS table_name, COUNT(*)::bigint AS row_count FROM public.notification_preferences
UNION ALL
SELECT 'notification_settings' AS table_name, COUNT(*)::bigint AS row_count FROM public.notification_settings
UNION ALL
SELECT 'offline_people' AS table_name, COUNT(*)::bigint AS row_count FROM public.offline_people
UNION ALL
SELECT 'poll_household_attendance' AS table_name, COUNT(*)::bigint AS row_count FROM public.poll_household_attendance
UNION ALL
SELECT 'poll_options' AS table_name, COUNT(*)::bigint AS row_count FROM public.poll_options
UNION ALL
SELECT 'poll_question_answers' AS table_name, COUNT(*)::bigint AS row_count FROM public.poll_question_answers
UNION ALL
SELECT 'poll_questions' AS table_name, COUNT(*)::bigint AS row_count FROM public.poll_questions
UNION ALL
SELECT 'poll_votes' AS table_name, COUNT(*)::bigint AS row_count FROM public.poll_votes
UNION ALL
SELECT 'polls' AS table_name, COUNT(*)::bigint AS row_count FROM public.polls
UNION ALL
SELECT 'profiles' AS table_name, COUNT(*)::bigint AS row_count FROM public.profiles
UNION ALL
SELECT 'push_subscriptions' AS table_name, COUNT(*)::bigint AS row_count FROM public.push_subscriptions
UNION ALL
SELECT 'treasury_entries' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_entries
UNION ALL
SELECT 'treasury_event_batches' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_event_batches
UNION ALL
SELECT 'treasury_event_participants' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_event_participants
UNION ALL
SELECT 'treasury_import_archive_lines' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_import_archive_lines
UNION ALL
SELECT 'treasury_import_batches' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_import_batches
UNION ALL
SELECT 'treasury_opening' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_opening
UNION ALL
SELECT 'treasury_transfers' AS table_name, COUNT(*)::bigint AS row_count FROM public.treasury_transfers
ORDER BY table_name;
