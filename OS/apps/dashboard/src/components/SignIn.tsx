import { supabase } from '../lib/supabase'

export function SignIn() {
  const signIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ground px-5">
      <div className="max-w-sm w-full bg-surface border border-line rounded-2xl shadow-sm p-8 text-center">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">
          Andrew's Dashboard
        </p>
        <h1 className="font-serif text-2xl font-semibold text-ink mb-2">Sign in to continue</h1>
        <p className="text-sm text-dim mb-6">
          Weekly Bench, The Long View, and Today &amp; Triage, all in one place, synced to
          your account.
        </p>
        <button
          onClick={signIn}
          className="w-full bg-accent text-accentInk font-semibold text-sm rounded-lg py-2.5 hover:brightness-110 transition"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  )
}
