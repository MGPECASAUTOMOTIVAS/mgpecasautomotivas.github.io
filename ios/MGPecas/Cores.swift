import UIKit

/// Cores do app (as mesmas do app.css do catálogo).
extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xff) / 255,
                  green: CGFloat((rgb >> 8) & 0xff) / 255,
                  blue: CGFloat(rgb & 0xff) / 255,
                  alpha: 1)
    }

    /// Azul MG (#0b4ea2); no modo escuro, o fundo do topo (#141c2b). Igual à tela de abertura (FundoAbertura).
    static let mgAbertura = UIColor(named: "FundoAbertura") ?? UIColor(rgb: 0x0b4ea2)

    /// Fundo das telas do catálogo: #f2f5f9 no claro, #0b1220 no escuro.
    static let mgFundo = UIColor { tracos in
        tracos.userInterfaceStyle == .dark ? UIColor(rgb: 0x0b1220) : UIColor(rgb: 0xf2f5f9)
    }
}
