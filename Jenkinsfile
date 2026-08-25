node {
  def imageTag = ''
  def registry = 'ghcr.io/ligen-gycx'
  def buildkit = 'tcp://buildkitd.build.svc.cluster.local:1234'

  stage('Checkout') {
    checkout scm
    imageTag = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim() + "-ci-${env.BUILD_NUMBER}"
  }

  stage('Build and push backend') {
    sh """set -eux
      export PATH=/var/jenkins_home/bin:\$PATH
      buildctl --addr ${buildkit} build \\
        --frontend dockerfile.v0 \\
        --local context=backend \\
        --local dockerfile=backend \\
        --output type=image,name=${registry}/k8s-lg-assessment-backend:${imageTag},push=true
    """
  }

  stage('Build and push frontend') {
    sh """set -eux
      export PATH=/var/jenkins_home/bin:\$PATH
      buildctl --addr ${buildkit} build \\
        --frontend dockerfile.v0 \\
        --local context=frontend \\
        --local dockerfile=frontend \\
        --output type=image,name=${registry}/k8s-lg-assessment-frontend:${imageTag},push=true
    """
  }

  stage('Render and deploy manifest') {
    sh """set -eux
      export PATH=/var/jenkins_home/bin:\$PATH
      helm lint deploy/charts/assessment-app
      helm template assessment-app deploy/charts/assessment-app \\
        --namespace assessment \\
        -f deploy/charts/assessment-app/values-cloud.yaml \\
        --set frontend.tag=${imageTag} \\
        --set backend.tag=${imageTag} | kubectl apply -f -
      kubectl -n assessment rollout status deployment/assessment-api --timeout=5m
      kubectl -n assessment rollout status deployment/assessment-web --timeout=5m
    """
  }

  stage('Verify') {
    sh '''set -eux
      export PATH=/var/jenkins_home/bin:$PATH
      kubectl -n assessment get deploy,pod,svc,ingress -o wide
      curl --fail --silent --show-error http://assessment-api.assessment.svc.cluster.local:8080/actuator/health
    '''
  }
}
