import { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, RefreshCw, Server } from 'lucide-react';
import './styles.css';

type Task = { id: number; title: string; description: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE'; createdAt: string };

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); const response = await fetch('/api/tasks'); setTasks(await response.json()); setLoading(false); };
  useEffect(() => { void load(); }, []);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) });
    setTitle(''); setDescription(''); await load();
  };
  return <main>
    <header><div className="brand"><Server size={22}/><span>LG Assessment</span></div><button className="icon" onClick={() => void load()} aria-label="刷新"><RefreshCw size={18}/></button></header>
    <section className="intro"><p className="eyebrow">KUBERNETES DELIVERY BOARD</p><h1>Full-stack delivery</h1><p>Track the assessment from source code to a running service.</p></section>
    <section className="board"><form onSubmit={add}><h2>Create task</h2><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Task title"/><textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="Description (optional)"/><button className="primary"><Plus size={18}/> Add task</button></form>
    <div className="tasks"><div className="section-head"><h2>Tasks</h2><span>{tasks.length}</span></div>{loading ? <p className="muted">Loading tasks...</p> : tasks.map(task => <article key={task.id}><div><h3>{task.title}</h3><p>{task.description || 'No description'}</p></div><span className={'status ' + task.status.toLowerCase()}>{task.status.replace('_', ' ')}</span></article>)}</div></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);

