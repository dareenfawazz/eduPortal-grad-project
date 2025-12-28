import React, { useEffect, useState } from 'react';

const NavItem = ({ id, label, onClick, active }) => (
  <button
    onClick={() => onClick(id)}
    style={{
      display: 'block',
      width: '100%',
      padding: '10px 12px',
      textAlign: 'left',
      border: 'none',
      background: active ? '#2c7be5' : 'transparent',
      color: active ? '#fff' : '#222',
      cursor: 'pointer'
    }}
  >
    {label}
  </button>
);

const ListView = ({ title, items = [], onEdit, onCreate }) => (
  <div style={{ padding: 16 }}>
    <h2>{title}</h2>
    <div style={{ marginBottom: 12 }}>
      <button onClick={onCreate} style={{ padding: '8px 12px' }}>Create New</button>
    </div>
    {items.length === 0 ? (
      <div>No data.</div>
    ) : (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {Object.keys(items[0]).map(k => <th key={k} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{k}</th>)}
            <th style={{ padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id || JSON.stringify(it)}>
              {Object.keys(it).map(k => <td key={k} style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{String(it[k])}</td>)}
              <td style={{ padding: 8 }}>
                <button onClick={() => onEdit(it)} style={{ marginRight: 8 }}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const FormView = ({ title, initial = {}, fields, onCancel, onSave }) => {
  const [state, setState] = useState(initial);
  useEffect(() => setState(initial), [initial]);
  const handleChange = (k, v) => setState(s => ({ ...s, [k]: v }));

  return (
    <div style={{ padding: 16 }}>
      <h2>{title}</h2>
      <form onSubmit={e => { e.preventDefault(); onSave(state); }}>
        {fields.map(f => (
          <div key={f.name} style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea value={state[f.name] || ''} onChange={e => handleChange(f.name, e.target.value)} style={{ width: '100%', padding: 8 }} />
            ) : (
              <input
                type={f.type || 'text'}
                value={state[f.name] || ''}
                onChange={e => handleChange(f.name, e.target.value)}
                style={{ width: '100%', padding: 8 }}
              />
            )}
          </div>
        ))}
        <div>
          <button type="submit" style={{ marginRight: 8 }}>Save</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
};

export default function AdminApp() {
  const [view, setView] = useState('dashboard');
  const [subView, setSubView] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({});
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setMessage(null);
    if (view === 'dashboard') {
      fetchData('/admin/dashboard', 'GET', 'dashboardSummary');
    } else if (view === 'terms') {
      fetchData('/admin/terms', 'GET', 'terms');
    } else if (view === 'users' && !subView) {
      setData(d => ({ ...d, usersMenu: true }));
    } else if (subView) {
      if (subView === 'students') fetchData('/admin/users/students', 'GET', 'students');
      if (subView === 'teachers') fetchData('/admin/users/teachers', 'GET', 'teachers');
      if (subView === 'parents') fetchData('/admin/users/parents', 'GET', 'parents');
    }
  }, [view, subView]);

  async function fetchData(url, method = 'GET', key = null, body = null) {
    setLoading(true);
    try {
      const opts = { method, headers: {} };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json().catch(() => null);
      if (key) setData(prev => ({ ...prev, [key]: json }));
      setLoading(false);
      return json;
    } catch (err) {
      setMessage(String(err));
      setLoading(false);
      return null;
    }
  }

  function go(to, sub = null) {
    setEditing(null);
    setView(to);
    setSubView(sub);
  }

  const openCreate = (kind) => {
    setEditing({ __kind: kind, mode: 'create' });
  };
  const openEdit = (kind, item) => {
    setEditing({ __kind: kind, mode: 'edit', payload: item });
  };

  async function handleSaveEntity(state) {
    const kind = editing.__kind;
    const mode = editing.mode;
    try {
      if (kind === 'students') {
        if (mode === 'create') {
          await fetchData('/admin/users/create-student', 'POST', null, state);
        } else {
          await fetchData(`/admin/users/edit-student/${state.id}`, 'POST', null, state);
        }
        setMessage('Saved.');
        setEditing(null);
        fetchData('/admin/users/students', 'GET', 'students');
      } else if (kind === 'teachers') {
        if (mode === 'create') {
          await fetchData('/admin/users/create-teacher', 'POST', null, state);
        } else {
          await fetchData(`/admin/users/edit-teacher/${state.id}`, 'POST', null, state);
        }
        setMessage('Saved.');
        setEditing(null);
        fetchData('/admin/users/teachers', 'GET', 'teachers');
      } else if (kind === 'parents') {
        if (mode === 'create') {
          await fetchData('/admin/users/create-parent', 'POST', null, state);
        } else {
          await fetchData(`/admin/users/edit-parent/${state.id}`, 'POST', null, state);
        }
        setMessage('Saved.');
        setEditing(null);
        fetchData('/admin/users/parents', 'GET', 'parents');
      } else if (kind === 'terms') {
        if (mode === 'create') {
          await fetchData('/admin/terms/create', 'POST', null, state);
        }
        if (mode === 'activate') {
          await fetchData(`/admin/terms/activate/${state.id}`, 'POST', null, {});
        }
        setMessage('Saved.');
        setEditing(null);
        fetchData('/admin/terms', 'GET', 'terms');
      }
    } catch (err) {
      setMessage('Error saving.');
    }
  }

  const entityFields = {
    students: [
      { name: 'id', label: 'ID', type: 'text' },
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'class', label: 'Class' }
    ],
    teachers: [
      { name: 'id', label: 'ID', type: 'text' },
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'subject', label: 'Subject' }
    ],
    parents: [
      { name: 'id', label: 'ID', type: 'text' },
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone' }
    ],
    terms: [
      { name: 'id', label: 'ID', type: 'text' },
      { name: 'name', label: 'Term Name' },
      { name: 'startDate', label: 'Start Date', type: 'text' },
      { name: 'endDate', label: 'End Date', type: 'text' }
    ]
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Segoe UI, Roboto, Arial' }}>
      <div style={{ width: 260, borderRight: '1px solid #eee', padding: 12 }}>
        <h3 style={{ margin: '6px 0' }}>Admin Panel</h3>
        <NavItem id="dashboard" label="Dashboard" onClick={() => go('dashboard')} active={view === 'dashboard'} />
        <NavItem id="users" label="Users" onClick={() => go('users')} active={view === 'users' && !subView} />
        {view === 'users' && (
          <div style={{ marginLeft: 8 }}>
            <NavItem id="students" label="Students" onClick={() => setSubView('students')} active={subView === 'students'} />
            <NavItem id="teachers" label="Teachers" onClick={() => setSubView('teachers')} active={subView === 'teachers'} />
            <NavItem id="parents" label="Parents" onClick={() => setSubView('parents')} active={subView === 'parents'} />
          </div>
        )}
        <NavItem id="terms" label="Academic Terms" onClick={() => go('terms')} active={view === 'terms'} />
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Reports</div>
          <button onClick={() => window.open('/admin/reports/attendance/class', '_blank')} style={{ display: 'block', width: '100%', padding: 8, marginBottom: 6 }}>Attendance - Class</button>
          <button onClick={() => window.open('/admin/reports/grades/class', '_blank')} style={{ display: 'block', width: '100%', padding: 8 }}>Grades - Class</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{view.toUpperCase()}</strong>
            {subView ? ` / ${subView}` : ''}
          </div>
          <div style={{ color: '#666' }}>{loading ? 'Loading...' : message}</div>
        </div>

        <div>
          {view === 'dashboard' && (
            <div style={{ padding: 16 }}>
              <h2>Dashboard</h2>
              <p>Administrative summary — depends on server response from /admin/dashboard.</p>
              <pre style={{ background: '#fafafa', padding: 12 }}>{JSON.stringify(data.dashboardSummary || {}, null, 2)}</pre>
            </div>
          )}

          {view === 'terms' && (
            <div>
              <div style={{ padding: 16 }}>
                <h2>Academic Terms</h2>
                <button onClick={() => setEditing({ __kind: 'terms', mode: 'create', payload: {} })}>Create Term</button>
                <div style={{ marginTop: 12 }}>
                  <pre style={{ background: '#fafafa', padding: 12 }}>{JSON.stringify(data.terms || [], null, 2)}</pre>
                </div>
              </div>
            </div>
          )}

          {view === 'users' && subView && (
            <div>
              {(!editing) && (
                <ListView
                  title={subView === 'students' ? 'Students' : subView === 'teachers' ? 'Teachers' : 'Parents'}
                  items={data[subView] || []}
                  onEdit={(it) => openEdit(subView, it)}
                  onCreate={() => openCreate(subView)}
                />
              )}

              {editing && (
                <FormView
                  title={editing.mode === 'create' ? `Create ${editing.__kind}` : `Edit ${editing.__kind}`}
                  initial={editing.payload || {}}
                  fields={entityFields[editing.__kind] || []}
                  onCancel={() => setEditing(null)}
                  onSave={(s) => handleSaveEntity(s)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
