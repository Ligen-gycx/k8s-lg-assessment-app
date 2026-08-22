import { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, RefreshCw, Server } from 'lucide-react';
import './styles.css';

type Task = { id: number; title: string; description: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE'; createdAt: string };

const statusText = {
  TODO: '待处理',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
} as const;

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
    <header><div className="brand"><Server size={22}/><span>美团天数池</span></div><button className="icon" onClick={() => void load()} aria-label="刷新任务"><RefreshCw size={18}/></button></header>
    <section className="intro"><p className="eyebrow">MEITUAN DAYS POOL</p><h1>天数池项目看板</h1><p>模拟会员天数权益从活动投放到运营监控的交付过程。</p></section>
    <section className="board"><form onSubmit={add}><h2>新建任务</h2><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="请输入任务名称"/><textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="请输入任务说明（可选）"/><button className="primary"><Plus size={18}/> 添加任务</button></form>
    <div className="tasks"><div className="section-head"><h2>任务列表</h2><span>{tasks.length}</span></div>{loading ? <p className="muted">正在加载任务...</p> : tasks.map(task => <article key={task.id}><div><h3>{task.title}</h3><p>{task.description || '暂无任务说明'}</p></div><span className={'status ' + task.status.toLowerCase()}>{statusText[task.status]}</span></article>)}</div></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
