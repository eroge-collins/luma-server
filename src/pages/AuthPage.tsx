import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react'

function AuthPage() {
    const [isLogin, setIsLogin] = useState(true)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({ email, password })
                if (error) throw error
            } else {
                if (!username.trim()) throw new Error('Username is required')
                if (username.length < 3) throw new Error('Username must be at least 3 characters')

                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { username: username.trim() } }
                })
                if (error) throw error

                if (data.user) {
                    const { error: profileError } = await supabase.from('profiles').insert({
                        id: data.user.id,
                        username: username.trim(),
                        status: 'online',
                    })
                    if (profileError) console.error('Profile creation error:', profileError)
                }
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-card__logo">
                    <div className="auth-card__logo-text">Luma</div>
                    <div className="auth-card__subtitle">
                        {isLogin ? 'Welcome back' : 'Create your account'}
                    </div>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                    {!isLogin && (
                        <div className="auth-form__field">
                            <label className="label" htmlFor="username">Username</label>
                            <input
                                id="username"
                                className="input"
                                type="text"
                                placeholder="Your display name"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                            />
                        </div>
                    )}

                    <div className="auth-form__field">
                        <label className="label" htmlFor="email">Email</label>
                        <input
                            id="email"
                            className="input"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                            required
                        />
                    </div>

                    <div className="auth-form__field">
                        <label className="label" htmlFor="password">Password</label>
                        <input
                            id="password"
                            className="input"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete={isLogin ? 'current-password' : 'new-password'}
                            required
                            minLength={6}
                        />
                    </div>

                    {error && <div className="auth-form__error">{error}</div>}

                    <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={loading}
                        style={{ width: '100%', marginTop: 8 }}
                    >
                        {loading ? (
                            <Loader2 style={{ animation: 'spin 0.7s linear infinite' }} />
                        ) : (
                            <>
                                {isLogin ? 'Sign In' : 'Create Account'}
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>

                    <div className="auth-form__switch">
                        {isLogin ? "Don't have an account? " : 'Already have an account? '}
                        <button type="button" onClick={() => { setIsLogin(!isLogin); setError('') }}>
                            {isLogin ? 'Sign Up' : 'Sign In'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default AuthPage
