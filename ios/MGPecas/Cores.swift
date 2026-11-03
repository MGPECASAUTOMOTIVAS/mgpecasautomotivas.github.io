import UIKit

/// Cores do app (as mesmas do app.css do catálogo). Só o tema claro: o catálogo abre sempre claro, e o app do iPhone
/// também (UIUserInterfaceStyle = Light no Info.plist). O tema escuro é escolhido dentro do catálogo (botão da lua).
extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xff) / 255,
                  green: CGFloat((rgb >> 8) & 0xff) / 255,
                  blue: CGFloat(rgb & 0xff) / 255,
                  alpha: 1)
    }

    /// Azul MG (#0b4ea2): fundo da tela de abertura (FundoAbertura) e da tela "sem internet".
    static let mgAbertura = UIColor(named: "FundoAbertura") ?? UIColor(rgb: 0x0b4ea2)

    /// Fundo das telas do catálogo no tema claro (#f2f5f9).
    static let mgFundo = UIColor(rgb: 0xf2f5f9)
}
