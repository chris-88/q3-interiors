import { CircleAlert, CircleCheck } from 'lucide-react'
import { Link } from 'react-router'
import { useChecklist, useMarkTestCalendar, useSetPrivacyReviewed, useTick } from '@/api/checklist'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { AdminOnly, BackToSettings } from '@/components/staff/settings-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { checklistItems, type ChecklistData, type ChecklistItem } from '@/lib/checklist'

function ItemActions({ item, data }: { item: ChecklistItem; data: ChecklistData }) {
  const me = useCurrentStaff()
  const tick = useTick()
  const markTest = useMarkTestCalendar()
  const privacy = useSetPrivacyReviewed()
  const failed = tick.isError || markTest.isError || privacy.isError
  return (
    <div className="flex flex-wrap items-center gap-2">
      {item.link &&
        (item.link.to === '/privacy' ? (
          <a
            href="#/privacy"
            target="_blank"
            rel="noopener"
            className="text-primary inline-flex min-h-12 items-center underline"
          >
            {item.link.label}
          </a>
        ) : (
          <Link
            to={item.link.to}
            className="text-primary inline-flex min-h-12 items-center underline"
          >
            {item.link.label}
          </Link>
        ))}
      {item.manual && (
        <Button
          variant={item.done ? 'ghost' : 'outline'}
          className="h-12"
          disabled={tick.isPending}
          onClick={() => tick.mutate({ key: item.manual!, on: !item.done, by: me.display_name })}
        >
          {item.done ? 'Untick' : 'Tick: done'}
        </Button>
      )}
      {item.action === 'privacy_review' && (
        <Button
          variant={item.done ? 'ghost' : 'outline'}
          className="h-12"
          disabled={privacy.isPending || (!item.done && !data.privacy_reviewable)}
          onClick={() => privacy.mutate(!item.done)}
        >
          {item.done ? 'Mark as draft again' : 'Mark reviewed'}
        </Button>
      )}
      {item.action === 'mark_test_calendar' && (
        <Button
          variant="outline"
          className="h-12"
          disabled={markTest.isPending}
          onClick={() => markTest.mutate(false)}
        >
          This is the test account
        </Button>
      )}
      {item.id === 'test_account' && data.test_calendar_email && (
        <Button
          variant="ghost"
          className="h-12"
          disabled={markTest.isPending}
          onClick={() => markTest.mutate(true)}
        >
          Forget the test account
        </Button>
      )}
      {failed && (
        <p role="alert" className="text-destructive w-full text-sm">
          That did not save. Please try again.
        </p>
      )}
    </div>
  )
}

export function ChecklistPage() {
  const checklist = useChecklist()
  const items = checklist.data ? checklistItems(checklist.data) : []
  const open = items.filter((i) => !i.done).length
  return (
    <AdminOnly>
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <h1 className="text-section text-ink font-bold">Go-live checklist</h1>
        <p className="text-muted-foreground text-sm">
          What stands between today and a paid campaign. Green items are done; amber items say what
          is left and where to fix it.
        </p>
        {checklist.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : checklist.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>Could not load the checklist. Please try again.</AlertDescription>
          </Alert>
        ) : (
          <>
            <output className="bg-background block rounded-md border p-4 font-medium">
              {open === 0
                ? 'Everything is done. Ready for a paid campaign.'
                : `${open} of ${items.length} still to do.`}
            </output>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`bg-background flex gap-3 rounded-md border border-l-4 p-4 ${item.done ? 'border-l-forest' : 'border-l-[#b7791f]'}`}
                >
                  {item.done ? (
                    <CircleCheck
                      className="text-forest mt-0.5 size-5 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 size-5 shrink-0 text-[#8a5a12]"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h2 className="font-bold">
                      <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
                      {item.title}
                    </h2>
                    <p className="text-muted-foreground text-sm">{item.detail}</p>
                    {item.manual && !item.done && (
                      <p className="text-muted-foreground text-xs">
                        The system cannot check this; tick it when it is done.
                      </p>
                    )}
                    <ItemActions item={item} data={checklist.data} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AdminOnly>
  )
}
