// InsightGenesis CI/CD.
//
// Builds directly in the live checkout at /root/InsightGenesis and reloads
// the root pm2 process. The controller runs as root so it can reach both.
//
// Triggering is a 5 minute poll: this host has no inbound connectivity, so a
// GitHub webhook cannot reach it. The Check stage compares origin/main against
// the last deployed sha and every later stage is skipped when they match.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
  }

  environment {
    APP_DIR    = '/root/InsightGenesis'
    GIT_CRED   = 'insightgenesis-github'
    PM2_APP    = 'insightgenesis'
    HEALTH_URL = 'http://localhost:5000/'
    // Survives WipeWorkspace, unlike a file kept in $WORKSPACE.
    STATE_DIR  = '/var/lib/jenkins/insightgenesis-state'
    // frontend/build is regenerated here and is tracked in git, so it is
    // excluded from the uncommitted-work guard below.
    GENERATED  = 'frontend/build'
  }

  stages {

    stage('Check for changes') {
      steps {
        dir(env.APP_DIR) {
          script {
            // Token is injected per-command, never persisted into .git/config.
            withCredentials([usernamePassword(
                credentialsId: env.GIT_CRED,
                usernameVariable: 'GIT_U',
                passwordVariable: 'GIT_P')]) {
              def remote = sh(
                script: '''
                  set -eu
                  git remote set-url origin https://github.com/InsightGenesisAI/InsightGenesis.git
                  git -c http.extraHeader="Authorization: Basic $(printf '%s:%s' "$GIT_U" "$GIT_P" | base64 -w0)" \
                      fetch --quiet origin main
                  git rev-parse origin/main
                ''',
                returnStdout: true
              ).trim()

              def last = sh(
                script: "cat ${env.STATE_DIR}/deployed-sha 2>/dev/null || true",
                returnStdout: true
              ).trim()

              env.IG_REMOTE_SHA = remote
              env.IG_HAS_CHANGES = (remote != last) ? 'true' : 'false'

              echo "origin/main : ${remote}"
              echo "last deployed: ${last ?: '(none)'}"
              if (env.IG_HAS_CHANGES == 'false') {
                echo "main unchanged, skipping build."
              }
            }
          }
        }
      }
    }

    stage('Preflight') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        dir(env.APP_DIR) {
          script {
            // The live tree is also the deploy target. If source was hand
            // edited here, the reset below would silently discard that work,
            // so refuse to build and make the operator commit or stash it.
            def dirty = sh(
              script: '''
                git status --porcelain -- . ':(exclude)frontend/build' ':(exclude)package-lock.json'
              ''',
              returnStdout: true
            ).trim()

            if (dirty) {
              error("""\
Refusing to build: ${env.APP_DIR} has uncommitted source changes:

${dirty}

The deploy resets this tree to origin/main and would lose them. Commit \
(and push) or stash them, then rebuild.""")
            }

            def branch = sh(script: 'git rev-parse --abbrev-ref HEAD', returnStdout: true).trim()
            if (branch != 'main') {
              error("Refusing to build: live checkout is on '${branch}', expected 'main'.")
            }
          }
          sh 'node --version && npm --version && git --version'
        }
      }
    }

    stage('Checkout') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        dir(env.APP_DIR) {
          withCredentials([usernamePassword(
              credentialsId: env.GIT_CRED,
              usernameVariable: 'GIT_U',
              passwordVariable: 'GIT_P')]) {
            sh('''
              set -eu
              git -c http.extraHeader="Authorization: Basic $(printf '%s:%s' "$GIT_U" "$GIT_P" | base64 -w0)" \
                  fetch --prune origin main
              git checkout -B main
              git reset --hard origin/main
              git log -1 --format='deployed commit: %h %s'
            ''')
          }
        }
      }
    }

    stage('Install') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        dir(env.APP_DIR) {
          sh 'npm install --no-audit --no-fund'
          sh 'npm --prefix frontend install --no-audit --no-fund'
        }
      }
    }

    stage('Build') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        dir(env.APP_DIR) {
          // `npm run build` is `tsc --noEmit && vite build`, so a type error
          // fails the build before anything is deployed.
          sh 'npm run build'
        }
      }
    }

    stage('Deploy') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        dir(env.APP_DIR) {
          sh '''
            set -eu
            pm2 reload "$PM2_APP" --update-env
            pm2 describe "$PM2_APP" | grep -E "status|restarts|uptime"
          '''
        }
      }
    }

    stage('Health check') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        // Fail loudly if the reloaded process is not actually serving.
        sh '''
          set -eu
          for i in $(seq 1 20); do
            code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)
            if [ "$code" = "200" ]; then
              echo "healthy after ${i} attempt(s): HTTP $code from $HEALTH_URL"
              exit 0
            fi
            echo "attempt ${i}: HTTP ${code:-none}, waiting"
            sleep 3
          done
          echo "app did not become healthy"
          pm2 logs "$PM2_APP" --lines 40 --nostream || true
          exit 1
        '''
      }
    }

    stage('Record') {
      when { expression { env.IG_HAS_CHANGES == 'true' } }
      steps {
        // Only advance the marker after the health check passes, so a failed
        // deploy is retried on the next poll instead of being skipped.
        sh "mkdir -p ${env.STATE_DIR} && printf '%s\\n' '${env.IG_REMOTE_SHA}' > ${env.STATE_DIR}/deployed-sha"
        echo "recorded deployed sha ${env.IG_REMOTE_SHA}"
      }
    }
  }

  post {
    always {
      script {
        if (env.IG_HAS_CHANGES == 'true') {
          // Archive the fresh build so it can be inspected after a deploy.
          dir(env.APP_DIR) {
            sh 'tar -czf "$WORKSPACE/frontend-build.tgz" frontend/build 2>/dev/null || true'
          }
          archiveArtifacts artifacts: 'frontend-build.tgz', fingerprint: true, allowEmptyArchive: true
        }
      }
    }
    failure {
      sh 'pm2 describe "${PM2_APP:-insightgenesis}" 2>/dev/null | grep -E "status|restarts" || true'
    }
  }
}