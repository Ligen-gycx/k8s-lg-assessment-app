# Kubernetes 全链路考核：本地虚拟机实施手册

> 目标：以当前 Mac 的最低资源完成一次可验收的 `GitHub -> Jenkins -> BuildKit -> GHCR -> Helm -> Kubernetes -> Ingress -> PostgreSQL` 闭环。
>
> 范围：优先完成考核必需项。不部署 RouterOS、Calico BGP、Pod 网段直连路由、Webhook、分支预览或高可用组件。

## 0. 当前已落地状态（2026-08-24）

本节是当前虚拟机作业环境的事实记录；下文第 1 至 9 节保留完整 CI/CD 路线和可复现步骤。两者有差异时，以本节和项目仓库中的部署清单为准。

### 0.1 当前拓扑与访问入口

| 项目 | 当前实现 |
| --- | --- |
| 控制平面与 NFS | `k8s-lg-master-recovery`，`192.168.2.7` |
| Worker | `k8s-lg-node1`，`192.168.2.5`；`k8s-lg-node2-recovery`，`192.168.2.8` |
| 对外应用入口 | `https://app.k8s.lab:30443/`，通过 Traefik NodePort `30443` 提供 HTTPS |
| 域名解析 | Mac 本机 hosts：`192.168.2.8 jenkins.k8s.lab app.k8s.lab headlamp.k8s.lab` |
| 入口链路 | `app.k8s.lab:30443` -> Traefik `websecure:8443` -> Ingress `spring-app` -> `spring-app:8080` ClusterIP |
| 应用 | 中文美团天数池任务看板；页面可新建任务、读取 PostgreSQL 数据、刷新并显示当前 API 响应节点 |
| 后端负载均衡 | `spring-app` 为 2 个副本，分别运行在 `k8s-lg-node1` 和 `k8s-lg-node2-recovery`；Service 的 EndpointSlice 同时维护两个 `8080` Endpoint |
| 数据库 | PostgreSQL 单副本，`postgresql:5432` ClusterIP；数据使用静态 NFS PVC |

原 `k8s-lg-master` 与 `k8s-lg-node2` 在 Multipass/QEMU 异常后的旧实例与磁盘备份均保留，但不再参与当前调度；为不丢失已部署数据，恢复环境使用了带 `-recovery` 后缀的控制平面和第二个工作节点。不要在旧节点上继续发布工作负载。

本次只恢复并验收了培训要求的应用入口。`jenkins.k8s.lab`、`headlamp.k8s.lab` 已具备本机 hosts 解析，但对应工作负载不在当前最小演示范围内。原计划中的 Jenkins、BuildKit、GHCR 自动推送与自动 Helm 发布仍属于后续完整 CI/CD 阶段，不能作为本次 1-13 入口验收的已完成项。

### 0.2 已完成的 1-13 入口验收

1. 三个培训域名可由本机 hosts 解析。
2. 浏览器可正常打开 HTTPS 中文任务页面。
3. Traefik `websecure` Service 的 `servicePort`、`targetPort`、`nodePort` 均已核验，其中 NodePort 为 `30443`。
4. Traefik Pod 的 `websecure` 容器端口为 `8443`。
5. Traefik 使用 `--entryPoints.websecure.address=:8443/tcp` 和 `--entryPoints.websecure.http.tls=true` 启用 TLS。
6. Ingress 宽表显示 `spring-app`、`CLASS=traefik`、`HOSTS=app.k8s.lab`、`PORTS=80,443`。
7. Ingress 明细确认 Host、后端 `spring-app:8080`、TLS Host 和 Secret `k8s-lab-tls`。
8. 应用与 PostgreSQL 均仅公开 ClusterIP Service，端口分别为 `8080`、`5432`。
9. `spring-app` Service Selector 为 `app.kubernetes.io/name=spring-app`。
10. Selector 选中两个 Ready 后端 Pod，且分布在两个可调度 Worker 上。
11. `spring-app` 的 EndpointSlice 自动维护两个 Ready Endpoint。
12. EndpointSlice 的 `http:8080` 与 API 容器的命名端口 `http:8080` 一致。
13. 通过 TLS 入口访问 `/actuator/health`，返回 `{"status":"UP","groups":["liveness","readiness"]}`。

完整命令输出、验证截图和页面截图见 [项目入口验证记录](k8s-lg-assessment-app/docs/vm-training-application-entry-1-13.md)。当前部署来源为 `platform/training-app-entry.yaml` 与 `platform/traefik.yaml`；后端双副本与 Downward API 节点信息展示也已同步到 Helm Chart 的 VM values。

## 1. 固定基线

### 1.1 节点名和资源

用户指定的名称使用大写 `LG`，但 Kubernetes Node 名必须符合小写 DNS 标签规则。因此实际 Multipass 实例名、主机名和 Kubernetes Node 名统一使用小写：

| 角色 | 实际名称 | CPU | 内存 | 磁盘 | 常驻工作负载 |
| --- | --- | ---: | ---: | ---: | --- |
| control-plane、NFS | `k8s-lg-master` | 2 | 2 GiB | 24 GiB | etcd、API Server、NFS |
| Jenkins、构建节点 | `k8s-lg-node1` | 2 | 3.5 GiB | 28 GiB | Jenkins、单个临时 Agent |
| DB、应用节点 | `k8s-lg-node2` | 2 | 2.5 GiB | 24 GiB | PostgreSQL、应用、Traefik、Headlamp |

总内存为 `8 GiB`，磁盘上限为 `76 GiB`。考核过程只允许一个 Jenkins Agent 运行。当前完整 CI/CD 计划中的 Jenkins、PostgreSQL、前端和 Traefik 均为单副本；已落地的培训入口例外，后端 API 为两个跨 Worker 副本，用于验证 Service 负载均衡，详见第 0 节。

### 1.2 技术范围

- Multipass `1.16.1+mac`、QEMU、Ubuntu 24.04。
- Kubernetes `v1.36`、containerd、Calico VXLAN。
- Traefik 是唯一入口，业务 Service 保持 `ClusterIP`。
- NFSv4 由 master 提供；Jenkins 和 PostgreSQL 使用静态 NFS PV/PVC。
- BuildKit 使用 Rootless 模式，不挂载 Docker Socket，不使用特权容器。
- 本方案验证 Pod 重建后的持久化，不代表备份、灾备或高可用。

## 2. 开工检查与创建虚拟机

执行位置：Mac 终端。

```zsh
setopt interactivecomments
multipass version
multipass get local.driver
multipass list
df -h .
memory_pressure
```

继续条件：没有同名实例，可用磁盘至少 `90 GiB`，并关闭 Docker Desktop、IDE、大量浏览器标签和本地模型服务。

```zsh
multipass launch 24.04 --name k8s-lg-master --cpus 2 --memory 2G --disk 24G
multipass launch 24.04 --name k8s-lg-node1 --cpus 2 --memory 3584M --disk 28G
multipass launch 24.04 --name k8s-lg-node2 --cpus 2 --memory 2560M --disk 24G

multipass list
for vm in k8s-lg-master k8s-lg-node1 k8s-lg-node2; do
  multipass info "$vm"
  multipass exec "$vm" -- hostnamectl --static
  multipass exec "$vm" -- ip -4 -br address
done
```

获取实际 IPv4，禁止把培训案例的 `192.168.0.*` 地址写入本环境：

```zsh
export MASTER_IP="$(multipass info k8s-lg-master | awk '/IPv4/ {print $2; exit}')"
export NODE1_IP="$(multipass info k8s-lg-node1 | awk '/IPv4/ {print $2; exit}')"
export NODE2_IP="$(multipass info k8s-lg-node2 | awk '/IPv4/ {print $2; exit}')"
printf 'master=%s\nnode1=%s\nnode2=%s\n' "$MASTER_IP" "$NODE1_IP" "$NODE2_IP"
ping -c 1 "$MASTER_IP"
ping -c 1 "$NODE1_IP"
ping -c 1 "$NODE2_IP"
```

节点不互通时停止。先解决 Multipass 默认网络，不引入 RouterOS。

## 3. 初始化三台节点

从 Mac 依次进入节点：

```zsh
multipass shell k8s-lg-master
multipass shell k8s-lg-node1
multipass shell k8s-lg-node2
```

在每台节点执行：

```bash
set -euo pipefail
sudo timedatectl set-ntp true
timedatectl status

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
sudo systemctl restart containerd
systemctl is-active containerd
```

继续在每台节点安装 Kubernetes：

```bash
set -euo pipefail
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
```

在两个 Worker 额外执行 Rootless BuildKit 节点参数。只适用于这个专用实验集群：

```bash
sudo tee /etc/sysctl.d/99-buildkit-rootless.conf >/dev/null <<'EOF'
kernel.apparmor_restrict_unprivileged_userns=0
EOF
sudo sysctl --system
sysctl user.max_user_namespaces
sysctl kernel.apparmor_restrict_unprivileged_userns
```

## 4. Kubernetes、Calico 与平台命名空间

执行位置：`k8s-lg-master`。

```bash
MASTER_IP="$(hostname -I | awk '{print $1}')"
sudo kubeadm init \
  --apiserver-advertise-address="$MASTER_IP" \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12

mkdir -p "$HOME/.kube"
sudo cp /etc/kubernetes/admin.conf "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"

kubectl apply -f \
  https://raw.githubusercontent.com/projectcalico/calico/v3.30.3/manifests/calico.yaml
kubeadm token create --print-join-command
```

复制最后一条输出，在 `k8s-lg-node1` 和 `k8s-lg-node2` 各执行一次。回到 master 验收：

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get --raw='/readyz?verbose'
```

继续条件：3 个 Node 都是 `Ready`，CoreDNS 与 Calico 均为 `Running`，API Server 通过 `readyz`。

建立环境变量和 Namespace：

```bash
MASTER_IP="$(kubectl get node k8s-lg-master -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')"
cat > "$HOME/platform.env" <<EOF
export CI_NAMESPACE=ci
export APP_NAMESPACE=assessment-app
export INGRESS_NAMESPACE=ingress-system
export HEADLAMP_NAMESPACE=headlamp
export NFS_SERVER=${MASTER_IP}
export NFS_CLIENT_CIDR=0.0.0.0/0
export JENKINS_HOST=jenkins.k8s.local
export APP_HOST=app.k8s.local
EOF
chmod 600 "$HOME/platform.env"
source "$HOME/platform.env"

kubectl create namespace "$CI_NAMESPACE"
kubectl create namespace "$APP_NAMESPACE"
kubectl create namespace "$INGRESS_NAMESPACE"
kubectl create namespace "$HEADLAMP_NAMESPACE"
```

`NFS_CLIENT_CIDR=0.0.0.0/0` 仅可用于受信任的本机 Multipass 网络。云服务器必须收紧为实际 Node CIDR。

## 5. NFS、PV/PVC、Traefik 和 Headlamp

执行位置：`k8s-lg-master`。

```bash
source "$HOME/platform.env"
sudo apt-get update
sudo apt-get install -y nfs-kernel-server
sudo install -d -o 1000 -g 1000 -m 0750 /srv/nfs/jenkins
sudo install -d -o 999 -g 999 -m 0700 /srv/nfs/postgresql
sudo tee /etc/exports.d/k8s-assessment.exports >/dev/null <<EOF
/srv/nfs/jenkins ${NFS_CLIENT_CIDR}(rw,sync,no_subtree_check,root_squash)
/srv/nfs/postgresql ${NFS_CLIENT_CIDR}(rw,sync,no_subtree_check,root_squash)
EOF
sudo exportfs -rav
sudo systemctl enable --now nfs-kernel-server
sudo exportfs -v
```

创建静态存储清单：

```bash
source "$HOME/platform.env"
cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-static
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: Immediate
reclaimPolicy: Retain
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: jenkins-nfs-pv
  labels: {storage-owner: jenkins}
spec:
  capacity: {storage: 8Gi}
  accessModes: [ReadWriteMany]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs-static
  nfs: {server: ${NFS_SERVER}, path: /srv/nfs/jenkins}
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgresql-nfs-pv
  labels: {storage-owner: postgresql}
spec:
  capacity: {storage: 8Gi}
  accessModes: [ReadWriteMany]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs-static
  nfs: {server: ${NFS_SERVER}, path: /srv/nfs/postgresql}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: jenkins-home, namespace: ${CI_NAMESPACE}}
spec:
  accessModes: [ReadWriteMany]
  storageClassName: nfs-static
  resources: {requests: {storage: 6Gi}}
  selector: {matchLabels: {storage-owner: jenkins}}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: postgresql-data, namespace: ${APP_NAMESPACE}}
spec:
  accessModes: [ReadWriteMany]
  storageClassName: nfs-static
  resources: {requests: {storage: 6Gi}}
  selector: {matchLabels: {storage-owner: postgresql}}
EOF
kubectl get pv
kubectl get pvc -A
```

两个 PVC 必须为 `Bound` 后才能部署数据库和 Jenkins。

安装 Helm、Traefik、Headlamp：

```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 -o /tmp/get_helm.sh
bash /tmp/get_helm.sh
rm -f /tmp/get_helm.sh
helm repo add traefik https://traefik.github.io/charts
helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/
helm repo update

helm upgrade --install traefik traefik/traefik \
  --namespace ingress-system \
  --set deployment.replicas=1 \
  --set service.type=NodePort \
  --set ports.web.nodePort=30080 \
  --set ports.websecure.nodePort=30443

helm upgrade --install headlamp headlamp/headlamp \
  --namespace headlamp --set replicaCount=1

kubectl get ingressclass
kubectl -n ingress-system rollout status deployment/traefik --timeout=5m
kubectl -n ingress-system get service traefik -o wide
kubectl -n headlamp rollout status deployment/headlamp --timeout=5m
```

原始实施顺序是先用 NodePort HTTP 打通功能，再加入 HTTPS、本地 CA、域名和 TLS Secret。当前最小培训入口已完成该后续步骤：Traefik 同时保留 HTTP `30080` 和 TLS `30443`，应用验收统一使用 `https://app.k8s.lab:30443/` 与 `k8s-lab-tls`。

## 6. PostgreSQL、Jenkins 和最小权限

### 6.1 PostgreSQL 前置条件

执行位置：`k8s-lg-master`。密码只经交互输入生成 Secret：

```bash
source "$HOME/platform.env"
read -rs -p 'PostgreSQL 密码: ' POSTGRES_PASSWORD; echo
kubectl -n "$APP_NAMESPACE" create secret generic app-db \
  --from-literal=POSTGRES_DB=assessment \
  --from-literal=POSTGRES_USER=assessment \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
unset POSTGRES_PASSWORD
```

部署 PostgreSQL：

```bash
source "$HOME/platform.env"
cat <<EOF | kubectl -n "$APP_NAMESPACE" apply -f -
apiVersion: v1
kind: Service
metadata: {name: postgresql}
spec:
  type: ClusterIP
  selector: {app: postgresql}
  ports:
    - {name: postgresql, port: 5432, targetPort: 5432}
---
apiVersion: apps/v1
kind: StatefulSet
metadata: {name: postgresql}
spec:
  serviceName: postgresql
  replicas: 1
  selector: {matchLabels: {app: postgresql}}
  template:
    metadata: {labels: {app: postgresql}}
    spec:
      nodeSelector: {kubernetes.io/hostname: k8s-lg-node2}
      securityContext: {fsGroup: 999}
      containers:
        - name: postgresql
          image: postgres:17-bookworm
          ports: [{containerPort: 5432}]
          envFrom: [{secretRef: {name: app-db}}]
          resources:
            requests: {memory: 400Mi, cpu: 200m}
            limits: {memory: 700Mi, cpu: 500m}
          volumeMounts: [{name: data, mountPath: /var/lib/postgresql/data}]
      volumes:
        - name: data
          persistentVolumeClaim: {claimName: postgresql-data}
EOF
kubectl -n "$APP_NAMESPACE" rollout status statefulset/postgresql --timeout=5m
kubectl -n "$APP_NAMESPACE" get statefulset,pod,service,pvc -o wide
```

资源建议：request `400Mi / 200m`，limit `700Mi / 500m`。验收时 `postgresql-0` 为 Running、Service 为 ClusterIP、PVC 为 Bound。

### 6.2 Jenkins 前置条件

```bash
source "$HOME/platform.env"
read -rp 'Jenkins 管理员用户名: ' JENKINS_ADMIN_ID
read -rs -p 'Jenkins 管理员密码: ' JENKINS_ADMIN_PASSWORD; echo
kubectl -n "$CI_NAMESPACE" create secret generic jenkins-admin \
  --from-literal=jenkins-admin-user="$JENKINS_ADMIN_ID" \
  --from-literal=jenkins-admin-password="$JENKINS_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
unset JENKINS_ADMIN_ID JENKINS_ADMIN_PASSWORD
```

安装 Jenkins：

```bash
source "$HOME/platform.env"
helm repo add jenkins https://charts.jenkins.io
helm repo update
cat > /tmp/jenkins-values.yaml <<EOF
controller:
  nodeSelector: {kubernetes.io/hostname: k8s-lg-node1}
  serviceType: ClusterIP
  admin:
    createSecret: false
    existingSecret: jenkins-admin
    userKey: jenkins-admin-user
    passwordKey: jenkins-admin-password
  resources:
    requests: {memory: 700Mi, cpu: 300m}
    limits: {memory: 1200Mi, cpu: "1"}
  installPlugins:
    - kubernetes
    - workflow-aggregator
    - github-branch-source
    - pipeline-groovy-lib
  ingress:
    enabled: true
    ingressClassName: traefik
    hostName: ${JENKINS_HOST}
persistence:
  enabled: true
  existingClaim: jenkins-home
EOF
helm upgrade --install jenkins jenkins/jenkins \
  --namespace "$CI_NAMESPACE" -f /tmp/jenkins-values.yaml
kubectl -n "$CI_NAMESPACE" rollout status statefulset/jenkins --timeout=10m
kubectl -n "$CI_NAMESPACE" get statefulset,pod,service,ingress,pvc -o wide
```

Jenkins 只运行一个 Controller，持久化到 `PVC/jenkins-home`。在 Jenkins 配置 Shared Library 时固定 `jenkins-json-build@v3.1.4`，Library Path 为 `shared-library`；Kubernetes Cloud 的 `containerCap=1`。

临时 Agent 必须使用 `nodeSelector: kubernetes.io/hostname=k8s-lg-node1`，并限制总内存上限为约 `1.5 GiB`：`jnlp 128Mi`、`maven 768Mi`、`buildkit 512Mi`、`helm 128Mi`。Maven 设置 `MAVEN_OPTS=-Xmx512m`。这保证 Controller 与 Agent 的峰值不会挤占 control-plane 或 PostgreSQL 所在节点。

创建 `ServiceAccount/jenkins-deployer` 并只绑定到 `assessment-app` 的 Role/RoleBinding。它可以更新应用 Deployment、Service、ConfigMap、Ingress、ReplicaSet；不能读取 Secret，也不能创建 Namespace。

```bash
source "$HOME/platform.env"
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata: {name: jenkins-deployer, namespace: ${CI_NAMESPACE}}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: jenkins-deployer, namespace: ${APP_NAMESPACE}}
rules:
  - apiGroups: [apps]
    resources: [deployments, replicasets]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [""]
    resources: [services, configmaps, pods]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [networking.k8s.io]
    resources: [ingresses]
    verbs: [get, list, watch, create, update, patch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: jenkins-deployer, namespace: ${APP_NAMESPACE}}
subjects:
  - kind: ServiceAccount
    name: jenkins-deployer
    namespace: ${CI_NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: jenkins-deployer
EOF
kubectl auth can-i patch deployments.apps -n "$APP_NAMESPACE" \
  --as system:serviceaccount:${CI_NAMESPACE}:jenkins-deployer
kubectl auth can-i get secrets -n "$APP_NAMESPACE" \
  --as system:serviceaccount:${CI_NAMESPACE}:jenkins-deployer
kubectl auth can-i create namespaces --all-namespaces \
  --as system:serviceaccount:${CI_NAMESPACE}:jenkins-deployer
```

预期依次为 `yes`、`no`、`no`。

## 7. 流水线与考核应用

### 7.1 先验证平台基线

先跑固定参考项目，再开发自己的项目：

```text
GitHub: https://github.com/sunweisheng/K8S-Deploying-Java.git
分支: main
基线: v1.0.8
共享库: jenkins-json-build v3.1.4
```

在 Jenkins 创建 Multibranch Pipeline：仅发现 `main`，Jenkinsfile 路径为 `Jenkinsfile`，公开仓库 Credentials 为 `none`，手动扫描一次。

临时 Agent 必须具备 `jnlp`、`maven`、`buildkit`、`helm` 四个容器。BuildKit 以 UID/GID `1000:1000` 运行，不挂载 Docker Socket，不使用 `privileged: true`。GHCR 推送凭据只挂载给 BuildKit，Kubernetes 部署 Token 只挂载给 Helm。

### 7.2 自己的考核项目

最小结构：

```text
assessment-project/
├── frontend/                 # React/Vue/Vite
├── backend/                  # Java 21 + Spring Boot 3 + Maven
├── deploy/charts/assessment-app/
├── ci/jenkins-agent.yaml
├── ci/jenkins-project.json
├── Jenkinsfile
└── docs/
```

最低功能和安全要求：

- 前端有任务列表、新增表单；请求路径使用 `/api`。
- 后端实现 `GET /api/tasks`、`POST /api/tasks`、`/actuator/health`。
- 后端仅通过 `postgresql` ClusterIP 访问数据库，密码从 `Secret/app-db` 注入。
- 镜像使用 commit SHA 与 digest，禁止 `latest`。
- 前后端各一个 Deployment、一个 ClusterIP Service；Ingress 将 `/` 路由到前端，将 `/api` 路由到后端。
- 当前培训入口的后端应保持 `replicas: 2`，并使用基于 `kubernetes.io/hostname` 的强制 Pod 反亲和性，使两个 API Pod 分布到两个 Worker；前端、Traefik、PostgreSQL 仍为单副本。
- API 通过 Downward API 注入 `POD_NAME`、`NODE_NAME`、`POD_IP`，实现 `GET /api/runtime`；前端“刷新数据与节点”按钮展示当前响应节点与最近采样，作为负载均衡的可视化证据。

流水线顺序固定：

```text
checkout 固定 commit
-> Maven test/package
-> npm ci/build
-> BuildKit 构建前后端镜像
-> 推送 GHCR 并读取 digest
-> helm lint/template
-> helm upgrade --install
-> kubectl rollout status
-> /actuator/health 冒烟检查
```

## 8. 验收与交付

执行位置：`k8s-lg-master`。

```bash
kubectl get nodes -o wide
kubectl get pv
kubectl -n assessment-app get statefulset,deployment,pod,service,ingress,pvc -o wide
kubectl -n assessment-app get endpointslice \
  -l kubernetes.io/service-name=assessment-api -o wide
kubectl -n assessment-app rollout status deployment/assessment-api --timeout=5m
helm list -A
helm history assessment-app -n assessment-app
```

演示顺序：

1. 浏览器访问入口，确认 Ingress。
2. 新增一条可识别任务，刷新并查询。
3. 展示 Ingress、Service、EndpointSlice 与 Pod 的关系。
4. 展示 Jenkins 构建编号、阶段日志、镜像 tag 与 digest。
5. 删除一个应用 Pod，等待 Deployment 补回，再刷新页面。
6. 删除 `postgresql-0`，等待 StatefulSet 恢复，再读取原任务。
7. 展示 PVC 为 Bound、Secret 仅显示名称和类型、Helm revision 与回滚命令。

当前最小作业演示可先按第 0.2 节的 1-13 顺序完成：先展示 hosts 和浏览器 HTTPS 页面，再展示 NodePort、Traefik TLS、Ingress、Service、Pod 与 EndpointSlice 的对应关系，最后从入口请求健康检查。页面连续点击“刷新数据与节点”，或连续访问 `/api/runtime`，应在多次采样中看到两个 Worker 的响应；Kubernetes Service 不承诺每一次请求严格轮换。

必须提交：GitHub 仓库 URL、分支、commit SHA、Jenkinsfile、Agent YAML、Helm Chart/Values、构建编号、镜像 digest、Kubernetes 验收输出、浏览器截图、重建验证、排障记录，以及单控制面/单 NFS/单库副本/无备份等已知限制。若仅交付当前培训入口作业，至少提交第 0.2 节 1-13 的命令结果、浏览器页面截图、Ingress/Service/EndpointSlice 截图，以及后端双副本跨节点采样证据；不得把尚未恢复的 Jenkins 自动流水线写为已验收。

## 9. 排障和资源保护

固定排查顺序：

```text
浏览器 / 域名 / NodePort
-> Ingress
-> Service
-> EndpointSlice
-> Pod 状态、describe、日志
-> 镜像与配置
-> PostgreSQL Service
-> Jenkins Agent
-> Helm
-> RBAC
```

先采集现场，不要先删除 Pod：

```bash
kubectl get nodes
kubectl get pods -A -o wide
kubectl get events -A --field-selector type=Warning --sort-by=.lastTimestamp
kubectl -n assessment-app describe deployment assessment-api
kubectl -n assessment-app logs deployment/assessment-api --tail=200
```

若 `readyz` 超时、控制面重启或 BuildKit OOM：停止构建并关闭宿主机大应用。仍不稳定时，只将 `k8s-lg-node1` 提升到 `3.5 GiB`；不要先增加 Jenkins 并发、给所有节点扩容，或将 BuildKit 改为特权容器。
