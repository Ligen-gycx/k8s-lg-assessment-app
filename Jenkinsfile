pipeline {
  agent any
  options { timestamps() }
  stages {
    stage('Verify') {
      steps {
        sh 'docker run --rm -v "$WORKSPACE/backend:/workspace" -w /workspace maven:3.9.11-eclipse-temurin-21 mvn -B verify'
        sh 'docker run --rm -v "$WORKSPACE/frontend:/workspace" -w /workspace node:22-alpine sh -c "npm install && npm run build"'
      }
    }
    stage('Build images') {
      steps {
        sh 'echo "Configure Rootless BuildKit build and GHCR push in Jenkins credentials before enabling this stage."'
      }
    }
    stage('Helm deploy') {
      steps {
        sh 'helm lint deploy/charts/assessment-app'
      }
    }
  }
}

