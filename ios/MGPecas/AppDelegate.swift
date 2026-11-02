import UIKit

/// Entrada do app. Uma janela só (SceneDelegate) com o catálogo (WebViewController).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuracao = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuracao.delegateClass = SceneDelegate.self
        return configuracao
    }
}
