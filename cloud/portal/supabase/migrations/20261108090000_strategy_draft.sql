-- D35 (owner review D1, 2026-11-08): the strategy draft is made at once and the agency adopts it with one approval.
-- Drafting needs no approval to start, so the old rule "a worker cannot authorize gated work" no longer covers it:
-- anything waiting for the agency (awaiting_approval) is now decided only by the agency, gated or not.
-- Not applied anywhere.
create or replace function public.transition_job(p_job uuid, p_to text, p_actor text, p_note text default null, p_data jsonb default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  -- Rejecting, authorizing gated work, and deciding anything that waits for the agency belong to the agency (approve_job).
  if p_to = 'rejected' or (p_to = 'authorized' and (j.requires_approval or j.status = 'awaiting_approval')) then
    raise exception 'only an agency approval can authorize or reject';
  end if;
  return private.move_job(p_job, p_to, 'agent', p_actor, p_note, p_data);
end;
$$;
revoke all on function public.transition_job(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.transition_job(uuid, text, text, text, jsonb) to service_role;
