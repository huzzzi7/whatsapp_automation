import { useEffect, useState, useCallback } from 'react';
import { getCampaignStats, listGreenInstances } from '../api';
import Card from '../components/ui/Card';

export default function HomePage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uniOpen, setUniOpen] = useState(false);
  const [totalInstances, setTotalInstances] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, instancesRes] = await Promise.allSettled([getCampaignStats(), listGreenInstances()]);
      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value);
      } else {
        throw statsRes.reason;
      }
      if (instancesRes.status === 'fulfilled') {
        setTotalInstances(Array.isArray(instancesRes.value) ? instancesRes.value.length : 0);
      } else {
        setTotalInstances(0);
      }
    } catch (e) {
      setError(e.message || 'Failed to load stats');
      setStats(null);
      setTotalInstances(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const universityStats = stats?.universityStats ?? [];

  return (
    <div className="home-dashboard">
      <h1>Welcome to the Dashboard</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Overview of logged campaign runs (after successful sends from the Campaign Wizard).
      </p>

      {error ? <div className="alert-error">{error}</div> : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading metrics…</p>
      ) : (
        <>
          <div className="home-dashboard__cards">
            <Card className="home-dashboard__card">
              <div className="home-dashboard__card-label">Total campaigns</div>
              <div className="home-dashboard__card-value">{stats?.totalCampaigns ?? 0}</div>
            </Card>
            <Card className="home-dashboard__card">
              <div className="home-dashboard__card-label">Total users sent</div>
              <div className="home-dashboard__card-value">{stats?.totalUsers ?? 0}</div>
            </Card>
            <Card className="home-dashboard__card">
              <div className="home-dashboard__card-label">Universities (distinct)</div>
              <div className="home-dashboard__card-value">{stats?.totalUniversities ?? 0}</div>
            </Card>
            <Card className="home-dashboard__card">
              <div className="home-dashboard__card-label">Total Instances</div>
              <div className="home-dashboard__card-value">{totalInstances}</div>
            </Card>
          </div>

          <Card className="home-dashboard__uni-section" style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              className="home-dashboard__uni-toggle"
              onClick={() => setUniOpen((o) => !o)}
              aria-expanded={uniOpen}
            >
              <span>Universities sent</span>
              <span className="home-dashboard__uni-chevron" aria-hidden>
                {uniOpen ? '−' : '+'}
              </span>
            </button>
            {uniOpen ? (
              <div className="home-dashboard__uni-list-wrap">
                {universityStats.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 0', fontSize: '14px' }}>
                    No university breakdown yet. Run a campaign from the Campaign Wizard.
                  </p>
                ) : (
                  <ul className="home-dashboard__uni-list">
                    {universityStats.map((u) => (
                      <li key={u.name} className="home-dashboard__uni-row">
                        <span className="home-dashboard__uni-name">{u.name}</span>
                        <span className="home-dashboard__uni-count">{u.usersSent} sent</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
