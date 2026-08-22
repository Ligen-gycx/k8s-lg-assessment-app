# k8s-lg-assessment-app

Kubernetes full-stack assessment application. The frontend is a React task board and the backend is a Spring Boot 3 REST API backed by PostgreSQL.

## Local development

Run PostgreSQL on `localhost:5432` with database `assessment`, user `assessment`, and password `assessment`.

```bash
cd backend && mvn spring-boot:run
cd frontend && npm install && npm run dev
```

The Vite dev server proxies `/api` to the backend. Production deployment is managed by the Helm chart in `deploy/charts/assessment-app`.

