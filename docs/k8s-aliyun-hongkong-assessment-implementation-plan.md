# Kubernetes 全链路考核：阿里云香港 ECS 实施手册

> 目标：在三台阿里云香港 ECS 上完成 GitHub -> Jenkins -> Rootless BuildKit -> GHCR -> Helm -> Kubernetes -> Traefik Ingress -> PostgreSQL 的 Java 全栈交付链路，并完成培训要求的应用入口 1-13 项验证。
>
> 本文以 [本地虚拟机实施手册](k8s-vm-assessment-implementation-plan.md) 的结构为基线，替换为当前香港 ECS 的实际网络、节点、镜像和部署状态。密码、私钥、GitHub Token、证书私钥均不写入本文或 Git 仓库。

## 0. 当前已落地状态（2026-08-25）

### 0.1 云端拓扑与入口

| 项目 | 当前实现 |
| --- | --- |
| Kubernetes | v1.36.4，containerd 2.2.1，Calico 网络正常 |
| 控制平面与 NFS | hk-k8s-master，私网 172.28.248.7；NFS 目录 /srv/k8s-nfs/spring-postgresql |
| 工作节点 | hk-k8s-node1，私网 172.28.248.8；hk-k8s-node2，私网 172.28.248.9 |
| 当前入口 ECS | hk-k8s-node1，公网入口 8.218.20.209；公网 IP 可能变更，以阿里云控制台为准 |
| 域名与 TLS | https://app.cloud.k8s.lab:30443/；Traefik websecure；TLS Secret assessment-cloud-tls |
| Helm 发布 | Release assessment-app，命名空间 assessment，状态 deployed |
| 前端 | assessment-web 单副本，位于 node1；由 Jenkins #3 发布的 GHCR 镜像 25ce016-ci-3 |
| 后端 | assessment-api 两副本，分别位于 node1/node2；由 Jenkins #3 发布的 GHCR 镜像 25ce016-ci-3 |
| 数据库 | postgresql-0 单副本，位于 node2；postgresql:5432 为 ClusterIP；PVC 为 Bound |
| 入口服务 | Traefik NodePort：HTTP 30080、HTTPS 30443；业务与数据库仅提供 ClusterIP |
| Jenkins / BuildKit | Jenkins 2.504.3 LTS（JDK 17）使用 NFS PVC；Jenkins #3 已通过 Rootless BuildKit 推送 GHCR，并经 Helm/kubectl 发布 |
| Headlamp | v0.45.0 单副本运行于 node2；仅 `view` 只读 RBAC，受控 Token 登录已验证，不保存或展示 Token |

当前数据库 tasks 表由 Flyway 建立，包含 3 条美团天数池初始化任务和 1 条页面联调测试记录。数据库查询证据见 [cloud-postgresql-tasks-terminal.png](.codex-tmp/cloud-postgresql-tasks-terminal.png)。

### 0.2 边界与限制

- 本方案是培训/考核环境：控制平面、NFS、PostgreSQL 都是单副本，不代表高可用或灾备。
- 公网仅应对培训电脑当前公网 IP /32 放行 SSH 和 Traefik NodePort；不得开放 Kubernetes API、etcd、NFS、数据库端口。
- 应用从 GHCR 拉取镜像，Helm 负责部署，凭据通过 Kubernetes Secret 管理。
- 浏览器被系统代理接管时，必须为 *.cloud.k8s.lab 和入口 ECS 公网 IP 配置 DIRECT 后再验收页面。

### 0.3 已验收的构建、恢复与可视化记录

- Jenkins Job `assessment-cicd` 的 #3 构建为 `SUCCESS`：完成 GitHub `main` 拉取、Maven/Java 21 校验、Vite 构建、Rootless BuildKit 推送 GHCR、Helm 清单渲染与 `kubectl -n assessment apply`，最终健康检查返回 `UP`。
- Jenkins Controller 已做真实重启验证；Job、插件及 `buildctl`、`kubectl`、`helm` 工具仍保留在 `ci/jenkins-home` 的 Bound NFS PVC 中。
- 数据持久化已做真实重启验证：通过 API 新建 `db-persistence-20260825` 后删除 `postgresql-0`，StatefulSet 自动恢复，任务记录仍可读取，`postgresql-data` PVC 仍为 Bound。
- Headlamp 已验证只读访问：可列出 Pod，不能读取 Secret；登录凭据是短时 Token，只在本机浏览器输入，未写入仓库、终端证据或飞书文档。完整截图见作业飞书文档的图 1a、1b、1c。

## 1. 固定基线

### 1.1 ECS 资源与职责

| 角色 | 名称 | 建议规格 | 常驻职责 |
| --- | --- | --- | --- |
| 控制平面、NFS | hk-k8s-master | 2 vCPU、4 GiB、40 GiB ESSD | kube-apiserver、etcd、NFS |
| Worker、入口、CI | hk-k8s-node1 | 2 vCPU、4 GiB、40 GiB ESSD | Traefik、Jenkins、BuildKit、前端、一个 API 副本 |
| Worker、数据库 | hk-k8s-node2 | 2 vCPU、4 GiB、40 GiB ESSD | PostgreSQL、一个 API 副本 |

三台实例须在同一香港地域、同一 VPC、同一 vSwitch、同一安全组。重新创建后必须使用控制台显示的真实私网/公网地址，禁止复制历史地址。

### 1.2 技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 前端 | React 19、TypeScript、Vite、Nginx Unprivileged | 中文天数池看板、任务列表、新建任务、刷新响应节点 |
| 服务端 | Java 21、Spring Boot 3.5、JDBC、Flyway、Actuator | /api/tasks、/api/runtime、/actuator/health |
| 数据库 | PostgreSQL 17、NFS 静态 PV/PVC | Flyway 建表与初始化，业务数据持久化 |
| 编排与入口 | Helm、Traefik、Ingress、TLS Secret | 业务 Service 保持 ClusterIP |
| 构建交付 | Jenkins LTS、Rootless BuildKit、GHCR | 无 Docker Socket、无特权容器 |

## 2. 阿里云准备与安全组

### 2.1 购买与初始化检查

1. 选择阿里云香港、Ubuntu 24.04 LTS，在同一 VPC/vSwitch 创建三台 ECS。
2. 三台实例使用同一 SSH 公钥；记录当前私网 IP、公网 IP、vSwitch CIDR、安全组 ID 和培训电脑公网 IP。
3. 为 node1 分配公网 IP 作为 Traefik 培训入口；master 不需要暴露 Kubernetes API。
4. 每台至少 2 vCPU、4 GiB 内存、40 GiB ESSD；PostgreSQL 数据不得使用临时盘。

### 2.2 最小安全组

| 方向 | 协议/端口 | 来源 | 用途 |
| --- | --- | --- | --- |
| 入方向 | TCP 22 | 培训电脑公网 IP /32 | SSH 管理 |
| 入方向 | TCP 30080、30443 | 培训电脑公网 IP /32 | Traefik HTTP/HTTPS |
| 入方向 | 全部协议 | 同一安全组或实际 vSwitch CIDR | Kubernetes、Calico、NFS 节点通信 |
| 出方向 | 必要的出网 | 按企业策略 | Ubuntu 软件源、GitHub、GHCR |

公网禁止开放 6443、2379-2380、10250、179、2049、5432。安全组若未启用同组互通，仅对实际 vSwitch CIDR 放行内部通信。

## 3. 节点初始化与 Kubernetes

以下命令在三台 ECS 分别执行。先用 hostname -s 和 ip -4 -br address 确认当前机器。

~~~bash
set -euo pipefail
sudo timedatectl set-ntp true
sudo swapoff -a
sudo sed -i.bak '/\sswap\s/s/^/#/' /etc/fstab

cat <<'EOF' | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

cat <<'EOF' | sudo tee /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system

sudo apt-get update
sudo apt-get install -y ca-certificates curl gpg containerd nfs-common
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl enable --now containerd
~~~

安装 Kubernetes v1.36：

~~~bash
export KUBERNETES_MINOR=v1.36
sudo mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL "https://pkgs.k8s.io/core:/stable:/${KUBERNETES_MINOR}/deb/Release.key" \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${KUBERNETES_MINOR}/deb/ /" \
  | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable --now kubelet
~~~

在承载 BuildKit 的 Worker 额外执行。此参数降低了用户命名空间限制，只适用于专用考核 Worker：

~~~bash
cat <<'EOF' | sudo tee /etc/sysctl.d/99-buildkit-rootless.conf
kernel.apparmor_restrict_unprivileged_userns=0
EOF
sudo sysctl --system
sysctl kernel.apparmor_restrict_unprivileged_userns
~~~

### 3.1 初始化控制平面

只在 hk-k8s-master 执行，控制面地址必须为当前私网 IP：

~~~bash
export MASTER_PRIVATE_IP='<当前 hk-k8s-master 私网 IP>'
sudo kubeadm init \
  --apiserver-advertise-address="$MASTER_PRIVATE_IP" \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12

mkdir -p "$HOME/.kube"
sudo cp /etc/kubernetes/admin.conf "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
kubeadm token create --print-join-command
~~~

将最后输出的 kubeadm join 命令在两个 Worker 分别执行，随后回到 master：

~~~bash
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.30.3/manifests/calico.yaml
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get --raw='/readyz?verbose'
~~~

继续条件：三个 Node 为 Ready，CoreDNS/Calico 为 Running，readyz 成功。云端 Calico 只使用 ECS 私网；不得引入本机 Multipass、RouterOS 或 192.168.2.* 配置。

## 4. NFS、PostgreSQL 与 Traefik

### 4.1 静态 NFS PV/PVC

在 master 配置 NFS。导出范围必须为当前 vSwitch CIDR，例如 172.28.248.0/24，不能使用 0.0.0.0/0：

~~~bash
export NFS_CLIENT_CIDR='<当前 vSwitch CIDR>'
sudo apt-get install -y nfs-kernel-server
sudo install -d -o 999 -g 999 -m 0700 /srv/k8s-nfs/spring-postgresql
cat <<EOF | sudo tee /etc/exports.d/k8s-assessment.exports
/srv/k8s-nfs/spring-postgresql $NFS_CLIENT_CIDR(rw,sync,no_subtree_check,root_squash)
EOF
sudo exportfs -rav
sudo systemctl enable --now nfs-kernel-server
~~~

创建 nfs-static StorageClass、assessment-postgresql-pv 和 assessment/postgresql-data PVC。PV 的关键字段：

~~~yaml
storageClassName: nfs-static
persistentVolumeReclaimPolicy: Retain
nfs:
  server: <hk-k8s-master 私网 IP>
  path: /srv/k8s-nfs/spring-postgresql
~~~

~~~bash
kubectl get pv
kubectl -n assessment get pvc
~~~

postgresql-data 必须为 Bound。Retain 表示删除 PVC 不会自动删除 NFS 数据，清理前必须人工确认。

### 4.2 数据库 Secret 和状态

密码仅交互输入，不存入文件：

~~~bash
read -rs -p 'PostgreSQL 密码: ' POSTGRES_PASSWORD; echo
kubectl -n assessment create secret generic assessment-db \
  --from-literal=password="$POSTGRES_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
unset POSTGRES_PASSWORD
~~~

部署 PostgreSQL StatefulSet 和 ClusterIP Service 后验证：

~~~bash
kubectl -n assessment rollout status statefulset/postgresql --timeout=5m
kubectl -n assessment get statefulset,pod,svc,pvc -o wide
~~~

期望 postgresql-0 为 1/1 Running、Service 为 ClusterIP:5432、PVC 为 Bound。数据库不创建 NodePort。

### 4.3 Traefik 与节点标签

~~~bash
kubectl label node hk-k8s-node1 assessment.ligen.io/role=ingress --overwrite
kubectl label node hk-k8s-node1 assessment.ligen.io/workload=true --overwrite
kubectl label node hk-k8s-node2 assessment.ligen.io/role=application --overwrite
kubectl label node hk-k8s-node2 assessment.ligen.io/workload=true --overwrite
kubectl -n ingress-system get svc traefik -o wide
~~~

Traefik 当前端口是 80:30080/TCP,30443:30443/TCP。应用 TLS Secret 是 assessment-cloud-tls，域名是 app.cloud.k8s.lab。

## 5. GHCR、Jenkins 与 Rootless BuildKit

### 5.1 GHCR 拉取凭据

GitHub Classic PAT 至少需要 read:packages 和 write:packages；私有仓库还需仓库读取权限。Token 仅在创建 Secret 时输入：

~~~bash
read -r -p 'GitHub 用户名: ' GHCR_USER
read -rs -p 'GitHub PAT: ' GHCR_TOKEN; echo
kubectl -n assessment create secret docker-registry ghcr-pull-config \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" \
  --docker-password="$GHCR_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
unset GHCR_USER GHCR_TOKEN
~~~

### 5.2 Jenkins 权限与流水线

- Jenkins Controller 位于 ci 命名空间，持久化使用 NFS PVC，numExecutors=0。
- 构建在临时 Agent 执行，单次只允许一个 Agent。
- jenkins-deployer 仅具备 assessment 命名空间的 Deployment、Service、Ingress、ConfigMap、ReplicaSet 发布权限，不能读取 Secret 或创建 Namespace。
- Rootless BuildKit 不挂 Docker Socket，不使用 privileged；GHCR 凭据只提供给 BuildKit，Kubernetes 凭据只提供给 Helm。

~~~bash
kubectl auth can-i patch deployments.apps -n assessment \
  --as system:serviceaccount:ci:jenkins-deployer
kubectl auth can-i get secrets -n assessment \
  --as system:serviceaccount:ci:jenkins-deployer
kubectl auth can-i create namespaces --all-namespaces \
  --as system:serviceaccount:ci:jenkins-deployer
~~~

预期结果为 yes、no、no。

构建顺序：Jenkins 拉取源码 -> Maven/Java 21 测试 -> Vite 构建 -> Rootless BuildKit 推送 GHCR -> Helm 模板渲染 -> `kubectl -n assessment apply` -> 等待工作负载 Ready。Jenkins 凭据已在集群内受控配置；`assessment-cicd` 的 #3 构建已成功完成上述链路，发布标签为 `25ce016-ci-3`。Jenkins #1、#2 为配置排障记录，不能作为最终成功凭据。

## 6. Helm 发布天数池应用

代码仓库：<https://github.com/Ligen-gycx/k8s-lg-assessment-app>

云端 values：deploy/charts/assessment-app/values-cloud.yaml。

~~~bash
cd /path/to/k8s-lg-assessment-app
helm lint deploy/charts/assessment-app
helm upgrade --install assessment-app deploy/charts/assessment-app \
  --namespace assessment \
  --create-namespace \
  -f deploy/charts/assessment-app/values-cloud.yaml \
  --wait --timeout 8m
~~~

| 组件 | 云端关键设置 |
| --- | --- |
| assessment-web | GHCR 前端镜像 25ce016-ci-3；单副本；节点标签 assessment.ligen.io/role: ingress |
| assessment-api | GHCR 后端镜像 25ce016-ci-3；双副本；两个 Worker 强制反亲和性 |
| Ingress | traefik；Host app.cloud.k8s.lab；TLS Secret assessment-cloud-tls |
| 数据库连接 | 后端只访问 postgresql:5432；密码由 Secret/assessment-db 注入 |

~~~bash
kubectl -n assessment get deploy,sts,pod,svc,ingress,pvc -o wide
kubectl -n assessment get endpointslice -l kubernetes.io/service-name=assessment-api -o wide
helm -n assessment list
~~~

期望两个 API Pod 跨 node1/node2，EndpointSlice 有两个 Ready 8080 Endpoint，前端和数据库保持单副本。

## 7. 应用入口 1-13 验证

在 master：

~~~bash
export KUBECONFIG=/etc/kubernetes/admin.conf
export ENTRY_PUBLIC_IP='8.218.20.209'
export APP_HOST='app.cloud.k8s.lab'
~~~

浏览器步骤在培训电脑执行。入口公网 IP 或证书变更时，必须替换变量和 hosts 记录。

| 步骤 | 验证命令或动作 | 通过标准 |
| --- | --- | --- |
| 1. 域名解析 | hosts 增加 ENTRY_PUBLIC_IP + APP_HOST | 域名指向当前入口 ECS |
| 2. 浏览器结果 | DIRECT 访问 https://APP_HOST:30443/ | 中文看板、任务数据、响应节点可见 |
| 3. NodePort | kubectl -n ingress-system get svc traefik | websecure NodePort 为 30443 |
| 4. Pod 端口 | kubectl -n ingress-system get deploy traefik -o yaml | targetPort=websecure 对应 8443 |
| 5. TLS 入口 | 同上检查 Traefik 参数 | websecure:8443 启用 TLS |
| 6. Ingress 宽表 | kubectl -n assessment get ingress | 显示 traefik、Host、80,443 |
| 7. Ingress 明细 | kubectl -n assessment describe ingress assessment-web | 后端、Host、TLS Secret 一致 |
| 8. 内部 Service | kubectl -n assessment get svc assessment-api postgresql | 均为 ClusterIP，端口 8080、5432 |
| 9. Service Selector | kubectl -n assessment get svc assessment-api -o yaml | app=assessment-api |
| 10. 被选 Pod | kubectl -n assessment get pod -l app=assessment-api -o wide | 两个 Ready Pod 跨两个 Worker |
| 11. EndpointSlice | kubectl -n assessment get endpointslice -l kubernetes.io/service-name=assessment-api -o wide | 两个 Ready Endpoint |
| 12. 端口一致 | EndpointSlice 与 Deployment YAML | 均为 8080 |
| 13. 健康检查 | 下方 curl | 返回 status=UP |

~~~bash
curl --noproxy '*' --cacert <CA证书路径> \
  --resolve "$APP_HOST:30443:$ENTRY_PUBLIC_IP" \
  "https://$APP_HOST:30443/actuator/health"

for i in {1..12}; do
  curl --noproxy '*' --cacert <CA证书路径> \
    --resolve "$APP_HOST:30443:$ENTRY_PUBLIC_IP" \
    "https://$APP_HOST:30443/api/runtime"
  echo
done
~~~

连续请求应观察到两个 API Pod 的响应节点切换。浏览器不通时，先检查安全组来源 IP /32、hosts、CA 信任和代理 DIRECT 规则。

## 8. 数据验收、交付与排障

### 8.1 PostgreSQL 只读验收

~~~bash
kubectl -n assessment exec statefulset/postgresql -- sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "\d tasks" \
  -c "SELECT id, title, status, created_at FROM tasks ORDER BY id;"'
~~~

应看到 tasks 表、状态约束和 Flyway 初始化数据。页面新建任务后再次查询，新增记录应存在，证明前端、Spring Boot、PostgreSQL 的数据链路一致。

### 8.2 交付物

- GitHub 仓库 URL、分支和 commit SHA。
- Jenkinsfile、Helm Chart、values-cloud.yaml、NFS/PostgreSQL 清单。
- Jenkins 构建编号、GHCR 镜像 tag/digest、Helm Release 状态。
- Node、Pod、PVC、Ingress、Service、EndpointSlice、页面和数据库截图。
- 1-13 项验证输出。
- Jenkins #3 成功日志、Jenkins NFS PVC/RBAC、PostgreSQL 重启持久化、Headlamp 登录与只读 Dashboard 截图，均已放入作业飞书文档。
- 已知限制：单控制平面、单 NFS、单 PostgreSQL、无备份、无自动故障切换。

### 8.3 排障顺序

1. kubectl get nodes -o wide：三节点必须 Ready。
2. kubectl -n assessment get pod -o wide：前端、两个 API、PostgreSQL 必须 Running。
3. kubectl -n assessment get pvc：数据库 PVC 必须 Bound。
4. kubectl -n assessment get svc,ingress,endpointslice：确认内部服务、TLS 路由和后端 Endpoint。
5. kubectl -n assessment logs deployment/assessment-api --tail=200：检查 Flyway、数据库连接与探针。
6. kubectl -n ingress-system get svc traefik：确认公网入口仍是 30443。
7. ImagePullBackOff：检查 ghcr-pull-config、镜像 tag、Package 可见性和 Worker 出网。
8. 页面超时：检查安全组、hosts、CA 信任、浏览器 DIRECT 规则。

## 9. 清理与恢复原则

- 清理前保存作业截图和命令输出，禁止导出 Secret 值。
- 删除 Release/PVC 前确认 PostgreSQL 数据是否需要保留；NFS PV 使用 Retain。
- 实验结束后收紧或删除安全组公网规则，撤销 GitHub PAT，停止或释放 ECS 避免持续计费。
- 重建 ECS 时重新核对私网 IP、公网 IP、vSwitch CIDR、NFS 导出范围、入口 hosts 和 TLS 证书，不得复制历史地址。
