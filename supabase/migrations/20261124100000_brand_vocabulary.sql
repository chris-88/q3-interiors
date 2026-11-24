-- Brand guide vocabulary (24 November 2026): the on-site appointment is a "site visit"; an
-- "estimate" is the price range discussed afterwards. Only the seeded placeholder text is
-- changed: if staff have already edited the label in Settings, it is left alone.
update public.appointment_types
set label = 'Site visit',
    description = 'We visit to see the space and take measurements, then talk you through an estimate.',
    updated_at = now()
where id = 'site_visit' and label = 'Estimate visit at your home';
