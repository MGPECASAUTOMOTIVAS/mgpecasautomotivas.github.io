import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let cena = scene as? UIWindowScene else { return }
        let janela = UIWindow(windowScene: cena)
        janela.rootViewController = WebViewController()
        janela.makeKeyAndVisible()
        window = janela
    }
}
