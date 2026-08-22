create table tasks (
  id bigserial primary key,
  title varchar(120) not null,
  description varchar(1000) not null default '',
  status varchar(20) not null check (status in ('TODO', 'IN_PROGRESS', 'DONE')),
  created_at timestamptz not null default now()
);

insert into tasks(title, description, status) values
  ('Provision Kubernetes cluster', 'Three-node Multipass cluster with Calico VXLAN.', 'DONE'),
  ('Deploy delivery platform', 'PostgreSQL, Jenkins, BuildKit and Ingress.', 'IN_PROGRESS');

