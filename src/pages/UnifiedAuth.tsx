import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, User, Shield, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function UnifiedAuth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already logged in
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await redirectBasedOnUserType(session.user);
      }
    };
    checkUser();
  }, [navigate]);

  const redirectBasedOnUserType = async (user: any) => {
    try {
      // Check if user has admin role in user_roles table
      const { data: userRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (userRole?.role) {
        // User has admin role
        navigate('/');
        return;
      }

      // Check if user is an employee by checking user metadata
      if (user.user_metadata?.role === 'employee') {
        // Check if password change is required
        const { data: employee } = await supabase
          .from('employees')
          .select('must_change_password')
          .eq('id', user.user_metadata.employee_id)
          .single();

        if (employee?.must_change_password) {
          navigate('/employee-change-password');
        } else {
          navigate('/employee-dashboard');
        }
        return;
      }

      // If no role found, try to find employee by email
      const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('email', user.email)
        .eq('is_active', true)
        .single();

      if (employee) {
        // Update user metadata to include employee info
        await supabase.auth.updateUser({
          data: {
            role: 'employee',
            employee_id: employee.id,
            name: employee.name
          }
        });

        if (employee.must_change_password) {
          navigate('/employee-change-password');
        } else {
          navigate('/employee-dashboard');
        }
      } else {
        // Default to admin dashboard
        navigate('/');
      }
    } catch (error) {
      console.error('Error determining user type:', error);
      // Default to admin dashboard on error
      navigate('/');
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // First try regular auth sign in
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        // If auth fails, check if this might be an employee login
        const { data: employee } = await supabase
          .from('employees')
          .select('*')
          .eq('email', email)
          .eq('is_active', true)
          .single();

        if (employee) {
          // Check if account is locked
          if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
            throw new Error('Account is temporarily locked. Please try again later.');
          }

          // Verify password using the stored hash
          const { data: passwordCheckResult, error: passwordError } = await supabase
            .rpc('verify_password', {
              password_input: password,
              password_hash: employee.password_hash
            });

          if (passwordError || !passwordCheckResult) {
            // Increment failed login attempts
            await supabase
              .from('employees')
              .update({ 
                failed_login_attempts: employee.failed_login_attempts + 1,
                locked_until: employee.failed_login_attempts >= 4 ? 
                  new Date(Date.now() + 30 * 60 * 1000).toISOString() : null
              })
              .eq('id', employee.id);
            
            throw new Error('Invalid email or password');
          }

          // Password is correct, create/update auth account
          const { error: signUpError } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
              data: {
                role: 'employee',
                employee_id: employee.id,
                name: employee.name
              }
            }
          });

          if (signUpError && !signUpError.message.includes('already registered')) {
            throw signUpError;
          }

          // Try to sign in again
          const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (retryError) {
            throw retryError;
          }

          // Update employee last login
          await supabase
            .from('employees')
            .update({
              last_login: new Date().toISOString(),
              failed_login_attempts: 0,
              locked_until: null
            })
            .eq('id', employee.id);

          toast({
            title: "Login successful",
            description: `Welcome back, ${employee.name}!`,
          });

          await redirectBasedOnUserType(retryData.user);
          return;
        }

        throw authError;
      }

      if (authData.user) {
        await redirectBasedOnUserType(authData.user);
      }

    } catch (error: any) {
      console.error('Login error:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (error) throw error;

      setError('Check your email for the confirmation link!');
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
      <Card className="w-full max-w-md shadow-glow">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">Welcome</CardTitle>
            <CardDescription>
              Sign in to access your dashboard or employee portal
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin" className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Sign In
              </TabsTrigger>
              <TabsTrigger value="signup" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Sign Up
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="transition-all focus:shadow-glow"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="transition-all focus:shadow-glow"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Lock className="mr-2 h-4 w-4" />
                  Sign In
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email Address</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="transition-all focus:shadow-glow"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Create a password (min 6 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="transition-all focus:shadow-glow"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <User className="mr-2 h-4 w-4" />
                  Create Account
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert className={`mt-4 ${error.includes('Check your email') ? '' : 'variant-destructive'}`}>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              The system will automatically detect your account type and redirect you accordingly.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}