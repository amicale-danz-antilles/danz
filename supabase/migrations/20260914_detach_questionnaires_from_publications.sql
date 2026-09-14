update public.polls
set linked_news_id = null,
    linked_event_id = null,
    updated_at = now()
where poll_type = 'questionnaire'
  and (linked_news_id is not null or linked_event_id is not null);
