import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { Session } from '@supabase/supabase-js'
import TitleBar from './components/TitleBar'
import AuthPage from './pages/AuthPage'
import MainPage from './pages/MainPage'

function App() {
    const [session, setSession] = useState<Session | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            setLoading(false)
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
        })

        return () => subscription.unsubscribe()
    }, [])

    // Don't show loading visual to avoid flick - just render nothing while loading
    if (loading) {
        return <div style={{ height: '100vh' }} />
    }

    return (
        <>
            <TitleBar />
            {session ? <MainPage session={session} /> : <AuthPage />}
        </>
    )
}

export default App
