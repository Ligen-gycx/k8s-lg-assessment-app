# Kubernetes 全栈考核作业记录

> 更新日期：2026-08-22  
> 项目仓库：[Ligen-gycx/k8s-lg-assessment-app](https://github.com/Ligen-gycx/k8s-lg-assessment-app)

## 1. 作业目标

使用本机 Multipass 创建三台 Ubuntu 虚拟机，搭建 Kubernetes 集群，并建立 Java 全栈应用的基础交付链路。当前已完成基础设施、Kubernetes 网络、NFS 持久化 PostgreSQL、GitHub SSH 授权与项目代码入库。

## 2. 当前架构

| 项目 | 当前实现 |
| --- | --- |
| 本机 | Apple Silicon Mac，Multipass `1.16.1+mac` |
| 控制平面 | `k8s-lg-master`，`192.168.2.4` |
| 工作节点 | `k8s-lg-node1`，`192.168.2.5`；`k8s-lg-node2`，`192.168.2.6` |
| Kubernetes | `v1.36.4`，containerd `2.2.1`，ARM64 |
| Pod 网络 | Calico `v3.31.3`，`10.244.0.0/16`，VXLAN，IPIP/BGP 关闭 |
| 持久化 | 控制平面 NFS Server，静态 NFS PV/PVC |
| 数据库 | PostgreSQL 17 StatefulSet，`assessment` 命名空间 |
| 代码 | React/Vite 前端、Spring Boot 3/Java 21 后端、PostgreSQL/Flyway、Helm Chart、Jenkinsfile |

## 3. 已完成步骤

### 3.1 创建虚拟机

创建三台 Ubuntu 24.04 LTS 虚拟机，并完成 containerd、kubelet、kubeadm、kubectl、NFS 客户端等基础组件安装。

验证命令：

```bash
multipass list
```

验证结果：三个实例均为 `Running`。

![Multipass 虚拟机状态](evidence/01-vms.png)

### 3.2 初始化 Kubernetes 集群

在控制平面通过 `kubeadm init` 初始化集群，配置：

- API Server：`192.168.2.4`
- Service CIDR：`10.96.0.0/12`
- Pod CIDR：`10.244.0.0/16`

随后使用 `kubeadm join` 将两个工作节点加入集群。最终三个节点均为 `Ready`。

### 3.3 部署 Calico VXLAN 网络

部署 Calico `v3.31.3`，使用可访问的镜像镜像源。为匹配本次最低资源虚拟机方案，网络模式使用 VXLAN，并明确关闭 IPIP 和 BGP。

验证命令：

```bash
kubectl get nodes -o wide
kubectl -n kube-system get pods -l k8s-app=calico-node -o wide
kubectl get ippools.crd.projectcalico.org \
  -o custom-columns=NAME:.metadata.name,CIDR:.spec.cidr,IPIP:.spec.ipipMode,VXLAN:.spec.vxlanMode
```

验证结果：3 个 Node 均为 `Ready`，3 个 `calico-node` 均为 `1/1 Running`，默认 IPPool 为 `10.244.0.0/16`、`IPIP=Never`、`VXLAN=Always`。

![Kubernetes 与 Calico 验证](evidence/02-kubernetes.png)

### 3.4 配置 NFS 与 PostgreSQL 持久化

在 `k8s-lg-master` 启用 NFS Server，并将 `/srv/k8s-nfs` 限制导出给 `192.168.2.0/24` 集群网段。部署 PostgreSQL 17 StatefulSet、ClusterIP Service 和 4Gi 静态 NFS PVC。

验证命令：

```bash
kubectl -n assessment get pods,pvc,svc
exportfs -v
```

验证结果：`postgresql-0` 为 `1/1 Running`，`postgresql-data` PVC 为 `Bound`，数据库服务通过 `5432/TCP` 提供集群内访问。

![NFS 与 PostgreSQL 验证](evidence/03-postgresql.png)

### 3.5 GitHub SSH 授权与代码入库

在 GitHub 账户级 SSH Keys 中添加本机 `id_rsa.pub`，并通过 `ssh-add --apple-use-keychain ~/.ssh/id_rsa` 解锁本机私钥。仓库远程地址使用 SSH：

```text
git@github.com:Ligen-gycx/k8s-lg-assessment-app.git
```

已推送的 `main` 分支提交：

```text
103b444 feat: scaffold full-stack assessment application
5fbef62 feat: add PostgreSQL persistent deployment
```

![GitHub main 分支验证](evidence/04-github.png)

## 4. 已实现的应用代码

- `frontend/`：React/Vite 任务看板，已通过 `npm run build`。
- `backend/`：Spring Boot 3、Java 21、Maven、Flyway、PostgreSQL。
- 后端接口：`GET /api/tasks`、`POST /api/tasks`、`/actuator/health`。
- `frontend/Dockerfile` 与 `backend/Dockerfile`：前后端容器化，其中后端以非 root 用户运行。
- `deploy/charts/assessment-app/`：前端、后端 Deployment/Service/Ingress 的 Helm Chart 模板。
- `platform/postgresql.yaml`：不含密码的 PostgreSQL/NFS 可复现部署清单；运行密码仅存储于 Kubernetes Secret。
- `Jenkinsfile`：Maven、前端构建和 Helm lint 的基础流水线定义。

## 5. 后续实施项

1. 部署 Traefik Ingress，提供统一 HTTP/HTTPS 入口。
2. 部署 Jenkins Controller、NFS PVC 与最小权限 ServiceAccount。
3. 配置 Rootless BuildKit、GHCR 凭据与镜像推送。
4. 完成 Jenkins 中的 Maven 测试、镜像构建、Helm 发布及回滚验证。
5. 验证浏览器到数据库的完整请求链路：浏览器 → Ingress → React → Spring Boot → PostgreSQL。

## 6. 证据说明

`evidence/` 下的 PNG 为当前环境真实命令输出生成的终端证据图。由于 macOS 未授予终端截屏权限，未使用显示器物理截屏；图中的节点、Pod、PVC 和 Git 提交数据均来自本次实际验证命令。
