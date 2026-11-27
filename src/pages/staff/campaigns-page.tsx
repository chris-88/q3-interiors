import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router'
import {
  campaignFormSchema,
  useAddCreative,
  useArchiveCreative,
  useCampaigns,
  useMarkLinkUsed,
  useSaveCampaign,
  type Campaign,
  type CampaignFormInput,
  type CampaignFormValues,
} from '@/api/campaigns'
import { AdminOnly, BackToSettings, SettingsCard } from '@/components/staff/settings-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { campaignLink, slugify } from '@/lib/campaigns'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'

function CampaignForm({ campaign, onDone }: { campaign?: Campaign; onDone?: () => void }) {
  const save = useSaveCampaign()
  const [slugTouched, setSlugTouched] = useState(Boolean(campaign))
  const locked = Boolean(campaign?.link_used_at)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CampaignFormInput, unknown, CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      name: campaign?.name ?? '',
      slug: campaign?.slug ?? '',
      utm_source: campaign?.utm_source ?? 'instagram',
      utm_medium: campaign?.utm_medium ?? 'paid_social',
      landing_route: campaign?.landing_route ?? '/',
      notes: campaign?.notes ?? '',
    },
  })
  const prefix = campaign ? `edit-${campaign.id.slice(0, 8)}` : 'new'
  const field = (name: keyof CampaignFormInput) => {
    const id = `${prefix}-${name}`
    const error = errors[name]?.message
    return {
      id,
      error,
      props: {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': `${id}-hint${error ? ` ${id}-error` : ''}`,
      },
    }
  }
  const name = field('name')
  const slug = field('slug')
  const source = field('utm_source')
  const medium = field('utm_medium')
  const notes = field('notes')
  const nameReg = register('name')
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        save.mutate(
          {
            id: campaign?.id,
            values: locked ? { ...values, slug: campaign?.slug ?? values.slug } : values,
          },
          { onSuccess: () => onDone?.() },
        ),
      )}
    >
      <FieldGroup>
        <Field data-invalid={name.error ? true : undefined}>
          <FieldLabel htmlFor={name.id}>Name</FieldLabel>
          <Input
            className="h-12 text-base"
            {...name.props}
            {...nameReg}
            onChange={(e) => {
              void nameReg.onChange(e)
              if (!slugTouched) setValue('slug', slugify(e.target.value))
            }}
          />
          <FieldDescription id={`${name.id}-hint`}>
            For you, for example “Spring kitchens 2027”.
          </FieldDescription>
          {name.error && <FieldError id={`${name.id}-error`}>{name.error}</FieldError>}
        </Field>
        <Field data-invalid={slug.error ? true : undefined}>
          <FieldLabel htmlFor={slug.id}>Link name (utm_campaign)</FieldLabel>
          <Input
            className="h-12 font-mono text-base"
            readOnly={locked}
            {...slug.props}
            {...register('slug', { onChange: () => setSlugTouched(true) })}
          />
          <FieldDescription id={`${slug.id}-hint`}>
            {locked
              ? 'Links with this name are already out, so it cannot change: the report would split in two.'
              : 'Goes into every link. Lower-case words joined by hyphens. Choose carefully: once a link is copied it is fixed.'}
          </FieldDescription>
          {slug.error && <FieldError id={`${slug.id}-error`}>{slug.error}</FieldError>}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field data-invalid={source.error ? true : undefined}>
            <FieldLabel htmlFor={source.id}>Source</FieldLabel>
            <Input className="h-12 text-base" {...source.props} {...register('utm_source')} />
            <FieldDescription id={`${source.id}-hint`}>Usually instagram.</FieldDescription>
            {source.error && <FieldError id={`${source.id}-error`}>{source.error}</FieldError>}
          </Field>
          <Field data-invalid={medium.error ? true : undefined}>
            <FieldLabel htmlFor={medium.id}>Medium</FieldLabel>
            <Input className="h-12 text-base" {...medium.props} {...register('utm_medium')} />
            <FieldDescription id={`${medium.id}-hint`}>paid_social for paid ads.</FieldDescription>
            {medium.error && <FieldError id={`${medium.id}-error`}>{medium.error}</FieldError>}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${prefix}-route`}>Where the link lands</FieldLabel>
          <NativeSelect
            id={`${prefix}-route`}
            className="h-12 w-full text-base"
            {...register('landing_route')}
          >
            <NativeSelectOption value="/">The home page</NativeSelectOption>
            <NativeSelectOption value="/enquire">Straight into the enquiry form</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field data-invalid={notes.error ? true : undefined}>
          <FieldLabel htmlFor={notes.id}>Notes (optional)</FieldLabel>
          <Textarea rows={2} className="text-base" {...notes.props} {...register('notes')} />
          <FieldDescription id={`${notes.id}-hint`}>Only you see these.</FieldDescription>
          {notes.error && <FieldError id={`${notes.id}-error`}>{notes.error}</FieldError>}
        </Field>
        {save.isError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{save.error.message}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-12 px-6" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
        </Button>
      </FieldGroup>
    </form>
  )
}

function LinkBuilder({ campaign }: { campaign: Campaign }) {
  const creatives = campaign.campaign_creatives.filter((c) => !c.archived_at)
  const [content, setContent] = useState('')
  const [copied, setCopied] = useState(false)
  const mark = useMarkLinkUsed()
  const link = campaignLink({
    siteUrl: SITE_URL,
    source: campaign.utm_source,
    medium: campaign.utm_medium,
    campaign: campaign.slug,
    content: content || null,
    route: campaign.landing_route,
  })
  const id = `link-${campaign.id.slice(0, 8)}`
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-creative`} className="text-sm font-medium">
        Creative (utm_content)
      </label>
      <NativeSelect
        id={`${id}-creative`}
        className="h-12 w-full text-base"
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setCopied(false)
        }}
      >
        <NativeSelectOption value="">No creative</NativeSelectOption>
        {creatives.map((c) => (
          <NativeSelectOption key={c.id} value={c.slug}>
            {c.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <label htmlFor={id} className="text-sm font-medium">
        Link
      </label>
      <Input
        id={id}
        readOnly
        value={link}
        className="h-12 font-mono text-sm"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-12 px-6"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(link)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
            mark.mutate(campaign.id)
          }}
        >
          Copy link
        </Button>
        <a
          href={link}
          target="_blank"
          rel="noopener"
          onClick={() => mark.mutate(campaign.id)}
          className="border-primary text-primary inline-flex h-12 items-center rounded-md border px-4 font-medium"
        >
          Test this link
        </a>
      </div>
      <output className="block text-sm">{copied ? 'Copied. Paste it into the ad.' : ''}</output>
    </div>
  )
}

function Creatives({ campaign }: { campaign: Campaign }) {
  const add = useAddCreative()
  const archive = useArchiveCreative()
  const [label, setLabel] = useState('')
  const slug = slugify(label)
  const id = `creative-${campaign.id.slice(0, 8)}`
  return (
    <div className="flex flex-col gap-2">
      {campaign.campaign_creatives.length === 0 ? (
        <p className="text-muted-foreground text-sm">No creatives yet. Add one per ad or post.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {campaign.campaign_creatives.map((c) => (
            <li
              key={c.id}
              className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1"
            >
              <span className={c.archived_at ? 'text-muted-foreground line-through' : ''}>
                {c.label} <span className="text-muted-foreground font-mono text-sm">{c.slug}</span>
              </span>
              <Button
                variant="ghost"
                className="h-12"
                onClick={() => archive.mutate({ id: c.id, archived: !c.archived_at })}
              >
                {c.archived_at ? 'Use again' : 'Retire'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={id} className="text-sm font-medium">
        New creative
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="h-12 min-w-0 flex-1 text-base"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-describedby={`${id}-hint`}
        />
        <Button
          variant="outline"
          className="h-12"
          disabled={slug.length < 1 || add.isPending}
          onClick={() =>
            add.mutate(
              { campaign_id: campaign.id, label: label.trim(), slug },
              { onSuccess: () => setLabel('') },
            )
          }
        >
          Add
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground text-sm">
        {slug ? `In links as ${slug}.` : 'A short label for one ad or post, for example Reel 1.'}
      </p>
      {add.isError && (
        <p role="alert" className="text-destructive text-sm">
          {add.error.message}
        </p>
      )}
    </div>
  )
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [editing, setEditing] = useState(false)
  const save = useSaveCampaign()
  const headingId = `campaign-${campaign.id.slice(0, 8)}`
  return (
    <section
      aria-labelledby={headingId}
      className="bg-background flex flex-col gap-4 rounded-md border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-title text-ink font-medium">
          {campaign.name}
        </h2>
        {campaign.archived_at && <Badge variant="outline">Archived</Badge>}
        {campaign.link_used_at && <Badge variant="secondary">Link in use</Badge>}
      </div>
      <p className="text-muted-foreground -mt-2 font-mono text-sm break-all">
        {campaign.utm_source} / {campaign.utm_medium} / {campaign.slug}
      </p>
      {editing ? (
        <CampaignForm campaign={campaign} onDone={() => setEditing(false)} />
      ) : (
        <>
          <h3 className="font-medium">Link builder</h3>
          <LinkBuilder campaign={campaign} />
          <h3 className="font-medium">Creatives</h3>
          <Creatives campaign={campaign} />
          <h3 className="font-medium">Spend</h3>
          <p className="text-sm">
            Spend is entered on the Ads page, under the campaign.{' '}
            <Link to={`/ads?campaign=${campaign.id}`} className="text-action underline">
              Enter spend
            </Link>
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button variant="outline" className="h-12" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close without saving' : 'Edit details'}
        </Button>
        <Button
          variant="ghost"
          className="h-12"
          onClick={() =>
            save.mutate({
              id: campaign.id,
              values: { archived_at: campaign.archived_at ? null : new Date().toISOString() },
            })
          }
        >
          {campaign.archived_at ? 'Make active again' : 'Archive'}
        </Button>
      </div>
    </section>
  )
}

export function CampaignsPage() {
  const campaigns = useCampaigns()
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const shown = (campaigns.data ?? []).filter((c) => showArchived || !c.archived_at)
  const archivedCount = (campaigns.data ?? []).filter((c) => c.archived_at).length
  return (
    <AdminOnly>
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <h1 className="text-section text-ink font-medium">Campaigns</h1>
        <p className="text-muted-foreground text-sm">
          One campaign per set of ads. Copy its link into the ad, enter what you spend, and the
          report shows what each enquiry and booking cost.
        </p>
        {creating ? (
          <SettingsCard title="New campaign" id="new-campaign-heading">
            <CampaignForm onDone={() => setCreating(false)} />
          </SettingsCard>
        ) : (
          <Button className="h-12 self-start px-6" onClick={() => setCreating(true)}>
            New campaign
          </Button>
        )}
        {campaigns.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : campaigns.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>Could not load campaigns. Please try again.</AlertDescription>
          </Alert>
        ) : shown.length === 0 ? (
          <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
            No campaigns yet.
          </p>
        ) : (
          shown.map((c) => <CampaignCard key={c.id} campaign={c} />)
        )}
        {archivedCount > 0 && (
          <label className="flex min-h-12 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived campaigns ({archivedCount})
          </label>
        )}
      </div>
    </AdminOnly>
  )
}
