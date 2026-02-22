// Redirect legacy /events to /activity
import { redirect } from 'next/navigation'

export default function EventsRedirect() {
  redirect('/activity')
}
