'use client'

import Link from 'next/link'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function HomeContent() {
  const searchParams = useSearchParams()
  const demoExpired = searchParams.get('demo_expired') === '1'
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false) // kept for compat, not used

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (res.ok) setSent(true)
    } catch {}
    setLoading(false)
  }

  const handleDemoClick = () => {
    window.location.href = '/demo'
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Demo expired banner */}
      {demoExpired && (
        <div className="w-full text-center py-2.5 px-4 text-xs font-medium" style={{ backgroundColor: '#031A3C', color: '#D3E4FF' }}>
          Your demo session expired after 30 minutes of inactivity.{' '}
          <button
            onClick={() => { window.location.href = '/demo' }}
            className="underline font-semibold hover:opacity-80 transition-opacity"
            style={{ color: '#62FB84' }}
          >
            Start a new demo
          </button>
        </div>
      )}
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6  flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#0063FF' }}>
              <span className="text-white font-bold text-xs">G</span>
            </div>
            <span className="font-medium text-gray-900 text-sm">GymAgents</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/login" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">Log in</Link>
            <Link
              href="/login"
              className="text-xs font-semibold text-white px-3 py-1.5  transition-colors"
              style={{ backgroundColor: '#0063FF' }}
            >
              Start free →
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 py-16 max-w-4xl mx-auto">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-6">
            Built for PushPress gyms
          </p>
          <h1 className="text-4xl font-semibold text-gray-900 mb-4 leading-tight tracking-tight">
            Your gym is losing members<br />
            <span style={{ color: '#0063FF' }}>you could have kept.</span>
          </h1>
          <p className="text-sm text-gray-500 mb-2 leading-relaxed max-w-lg">
            GymAgents watches every member&apos;s check-in pattern around the clock.
            When someone starts going quiet, it drafts a personal message from you —
            and asks if you want to send it.
          </p>
          <p className="text-xs text-gray-300 mb-10">
            CrossFit · BJJ · Yoga · Spin · Pilates · Functional fitness
          </p>

          {sent ? (
            <div className="border-l-2 pl-4 py-2 mb-6" style={{ borderColor: '#0063FF' }}>
              <p className="text-sm font-medium text-gray-900">Check your inbox</p>
              <p className="text-xs text-gray-500 mt-0.5">We sent a login link to {email}.</p>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="flex flex-col sm:flex-row gap-2 max-w-sm mb-4">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Your email"
                className="flex-1 px-3 py-2.5 border border-gray-200  text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="font-semibold px-4 py-2.5  transition-colors text-white text-sm disabled:opacity-60 whitespace-nowrap"
                style={{ backgroundColor: '#0063FF' }}
              >
                {loading ? 'Sending…' : 'Connect free →'}
              </button>
            </form>
          )}

          <div className="flex items-center gap-4">
            <p className="text-xs text-gray-400">Free for PushPress gyms. No card needed.</p>
            <span className="text-gray-200 select-none">·</span>
            <button
              onClick={handleDemoClick}
              disabled={demoLoading}
              className="text-xs font-medium transition-colors disabled:opacity-60 bg-transparent border-0 cursor-pointer p-0"
              style={{ color: '#0063FF' }}
            >
              {demoLoading ? 'Loading…' : 'Try demo →'}
            </button>
          </div>
        </div>
      </section>

      {/* Problem → Solution */}
      <section className="border-t border-gray-100 px-6 py-16" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">How it works</p>
          <h2 className="text-2xl font-semibold text-gray-900 mb-1 tracking-tight">PushPress shows you the data.</h2>
          <p className="text-sm text-gray-500 mb-10">GymAgents tells you what to do about it — then does it.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                before: 'PushPress shows attendance dropping for member #47.',
                after: 'GymAgents flags them, drafts a personal re-engagement note from you, and asks if you want to send it.',
              },
              {
                before: 'A new lead came in at 6am while you were asleep.',
                after: 'GymAgents drafted a warm follow-up. You approve it in 10 seconds when you wake up. Lead still warm.',
              },
              {
                before: 'A payment failed quietly in the background.',
                after: 'GymAgents caught it, drafted a friendly heads-up, and got it in front of you — before the member noticed.',
              }
            ].map((item, i) => (
              <div key={i} className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-1">Without</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{item.before}</p>
                </div>
                <div className="border-l-2 pl-3 py-1" style={{ borderColor: '#0063FF' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#0063FF' }}>With GymAgents</p>
                  <p className="text-xs text-gray-600 leading-relaxed">{item.after}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — steps */}
      <section className="px-6 py-16 max-w-4xl mx-auto border-t border-gray-100">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">The loop</p>
        <h2 className="text-2xl font-semibold text-gray-900 mb-10 tracking-tight">Runs every day. You just approve.</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              step: '01',
              title: 'Alex hasn\'t been in for 19 days',
              desc: 'Alex used to train 4x a week. GymAgents notices the shift, figures out the risk level, and flags it — weeks before Alex would cancel.',
            },
            {
              step: '02',
              title: 'Message drafted. Personal, not a template.',
              desc: '"Hey Alex — noticed you\'ve been away a bit. Everything alright? We\'d love to have you back. Thursday evenings have been great lately."',
            },
            {
              step: '03',
              title: 'Approve. Send. Member kept.',
              desc: 'One tap to send it as-is, or tweak it first. GymAgents remembers what worked and gets sharper over time.',
            }
          ].map((step, i) => (
            <div key={i}>
              <p className="text-xs font-semibold text-gray-200 mb-3 tracking-widest">{step.step}</p>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{step.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agents list */}
      <section className="border-t border-gray-100 px-6 py-16" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Agents</p>
          <h2 className="text-2xl font-semibold text-gray-900 mb-1 tracking-tight">Your autopilot team</h2>
          <p className="text-sm text-gray-500 mb-10">Turn them on one at a time. Each one runs on its own — no setup required.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {[
              {
                name: 'Churn watcher',
                desc: 'Checks every member\'s pattern daily. Flags who\'s going quiet before they cancel. Drafts a personal message for each one.',
                badge: 'Free',
              },
              {
                name: 'New lead responder',
                desc: 'New inquiry while you\'re coaching? GymAgents drafts a warm reply. You approve it before the lead goes cold.',
                badge: 'Starter',
              },
              {
                name: 'Missed payment catcher',
                desc: 'Payment failed? It catches it right away and drafts a kind heads-up — before the member knows there\'s a problem.',
                badge: 'Starter',
              },
              {
                name: 'Milestone celebrator',
                desc: 'Member hitting 6 months or a year? GymAgents drafts a personal note that makes them feel seen — and want to stay.',
                badge: 'Pro',
              },
              {
                name: 'Class fill-up watcher',
                desc: 'Spots consistently half-empty classes and tells you exactly who to nudge to fill the room.',
                badge: 'Pro',
              },
              {
                name: 'Revenue health tracker',
                desc: 'Watches billing trends, upcoming renewals, and payment health across your whole gym.',
                badge: 'Pro',
              },
            ].map((ap, i) => (
              <div key={i} className="bg-white border border-gray-200  px-4 py-4 flex items-start gap-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 mb-0.5">{ap.name}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{ap.desc}</p>
                </div>
                <span className="text-xs text-gray-400 font-medium flex-shrink-0 mt-0.5">{ap.badge}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-white border border-gray-200  px-4 py-4 text-center" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <p className="text-sm font-medium text-gray-700 mb-0.5">Need something specific?</p>
            <p className="text-xs text-gray-400">Build your own agent in plain English — describe what you want, and it&apos;s running in seconds.</p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16 max-w-4xl mx-auto border-t border-gray-100" id="pricing">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Pricing</p>
        <h2 className="text-2xl font-semibold text-gray-900 mb-1 tracking-tight">Simple. Obvious ROI.</h2>
        <p className="text-sm text-gray-500 mb-10">One kept member ($150+/mo) pays for a year of GymAgents.</p>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200  p-6" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Free</p>
              <p className="text-3xl font-semibold text-gray-900 mb-0.5">$0<span className="text-base text-gray-400 font-normal">/mo</span></p>
              <p className="text-xs text-gray-400">Forever, for PushPress gyms</p>
            </div>
            <ul className="space-y-2 mb-6">
              {['Churn watcher (always on)', 'Up to 5 at-risk members', 'Plain-English explanations', '3 scans per month'].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="text-gray-300 mt-0.5 flex-shrink-0">—</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="w-full block text-center text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5  transition-colors"
            >
              Get started free →
            </Link>
          </div>

          <div className="bg-white border-2  p-6 relative" style={{ borderColor: '#0063FF', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="absolute -top-3 left-4">
              <span className="text-xs font-semibold text-white px-2 py-0.5 " style={{ backgroundColor: '#0063FF' }}>Most popular</span>
            </div>
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#0063FF' }}>Starter</p>
              <p className="text-3xl font-semibold text-gray-900 mb-0.5">$49<span className="text-base text-gray-400 font-normal">/mo</span></p>
              <p className="text-xs text-gray-400">14-day free trial — no card needed</p>
            </div>
            <ul className="space-y-2 mb-6">
              {['Everything in Free', '3 agents running', '30 scans per month', 'One-tap message sending', 'New lead responder', 'Missed payment catcher'].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="mt-0.5 flex-shrink-0" style={{ color: '#0063FF' }}>—</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login?tier=starter"
              className="w-full block text-center text-xs font-semibold text-white px-4 py-2.5  transition-colors"
              style={{ backgroundColor: '#0063FF' }}
            >
              Start free trial →
            </Link>
          </div>

          <div className="bg-white border border-gray-200  p-6" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Pro</p>
              <p className="text-3xl font-semibold text-gray-900 mb-0.5">$97<span className="text-base text-gray-400 font-normal">/mo</span></p>
              <p className="text-xs text-gray-400">14-day free trial — no card needed</p>
            </div>
            <ul className="space-y-2 mb-6">
              {['Everything in Starter', 'All 6 agents on', 'Unlimited scans', 'Build custom agents', 'Auto-send mode', 'Priority support + onboarding'].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="text-gray-300 mt-0.5 flex-shrink-0">—</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login?tier=pro"
              className="w-full block text-center text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white px-4 py-2.5  transition-colors"
            >
              Start free trial →
            </Link>
          </div>
        </div>

        <div className="mt-4 border-l-2 pl-4 py-2" style={{ borderColor: '#0063FF' }}>
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">Don&apos;t have PushPress yet?</span>{' '}
            GymAgents runs on your PushPress member data. Most gyms are connected in 20 minutes.{' '}
            <a href="https://www.pushpress.com" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2" style={{ color: '#0063FF' }}>
              Get PushPress free →
            </a>
          </p>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-t border-gray-100 px-6 py-16" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">From owners</p>
          <h2 className="text-2xl font-semibold text-gray-900 mb-10 tracking-tight">For owners who&apos;d rather be on the floor</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name: 'Marcus T.', gym: 'Apex Strength & Conditioning', text: '"Used to spend Sunday mornings going through my list. GymAgents does it every day now. Got three people back the first week."' },
              { name: 'Priya S.', gym: 'Flow State Yoga Studio', text: '"The messages it drafts actually sound like me. I just hit send. Writing was the part I hated most."' },
              { name: 'Derek L.', gym: 'Ground Zero BJJ', text: '"Monthly churn was at 7%. First month with GymAgents I dropped it to 4.5%. At $130 a member that\'s real money."' }
            ].map((t, i) => (
              <div key={i} className="bg-white border border-gray-200  p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <p className="text-xs text-gray-500 leading-relaxed italic mb-4">{t.text}</p>
                <div>
                  <p className="text-xs font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.gym}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-6">* Testimonials represent expected outcomes based on industry retention benchmarks</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-gray-100 px-6 py-16 text-center" style={{ backgroundColor: '#031A3C' }}>
        <div className="max-w-md mx-auto">
          <h2 className="text-2xl font-semibold text-white mb-3 tracking-tight">Start keeping more members today.</h2>
          <p className="text-sm text-blue-200 mb-8">Connect your PushPress gym in 2 minutes. Your churn watcher starts running immediately — free.</p>
          <div className="flex flex-col items-center gap-3">
            <Link
              href="/login"
              className="font-semibold px-6 py-3  transition-colors text-sm text-gray-900 bg-white hover:bg-gray-50"
            >
              Connect My Gym — Free →
            </Link>
            <button
              onClick={handleDemoClick}
              disabled={demoLoading}
              className="text-xs font-medium text-blue-300 hover:text-white transition-colors disabled:opacity-60 bg-transparent border-0 cursor-pointer"
            >
              {demoLoading ? 'Loading…' : 'or try a live demo first →'}
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5  flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#0063FF' }}>
              <span className="text-white font-bold" style={{ fontSize: 9 }}>G</span>
            </div>
            <span className="text-xs font-medium text-gray-900">GymAgents</span>
            <span className="text-xs text-gray-300 ml-1">© 2026</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-gray-400">
            <Link href="/login" className="hover:text-gray-700 transition-colors">Log in</Link>
            <Link href="/#pricing" className="hover:text-gray-700 transition-colors">Pricing</Link>
            <a href="https://www.pushpress.com" target="_blank" rel="noopener" className="hover:text-gray-700 transition-colors">PushPress</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}
