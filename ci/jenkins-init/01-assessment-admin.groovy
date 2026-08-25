import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import jenkins.install.InstallState
import jenkins.model.Jenkins

def jenkins = Jenkins.get()
def realm = new HudsonPrivateSecurityRealm(false)
def passwordFile = new File(jenkins.getRootDir(), 'secrets/initialAdminPassword')

if (passwordFile.exists() && realm.getUser('assessment-admin') == null) {
  realm.createAccount('assessment-admin', passwordFile.text.trim())
}

jenkins.setSecurityRealm(realm)
def authorization = new FullControlOnceLoggedInAuthorizationStrategy()
authorization.setAllowAnonymousRead(false)
jenkins.setAuthorizationStrategy(authorization)
jenkins.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)
jenkins.save()
