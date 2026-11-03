import UIKit

/// Continuação da tela de abertura do sistema (mesmo fundo e mesmo logo do UILaunchScreen) enquanto o catálogo abre.
/// Some com um esmaecimento quando a página termina de carregar. Se a abertura demorar, aparece um indicador de espera.
final class AberturaView: UIView {
    private let logo = UIImageView(image: UIImage(named: "LogoAbertura"))
    private let espera = UIActivityIndicatorView(style: .medium)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .mgAbertura
        isAccessibilityElement = true
        accessibilityLabel = "Abrindo o catálogo MG"
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.contentMode = .center
        espera.translatesAutoresizingMaskIntoConstraints = false
        espera.color = .white
        espera.hidesWhenStopped = true
        addSubview(logo)
        addSubview(espera)
        NSLayoutConstraint.activate([
            logo.centerXAnchor.constraint(equalTo: safeAreaLayoutGuide.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            espera.centerXAnchor.constraint(equalTo: centerXAnchor),
            espera.topAnchor.constraint(equalTo: logo.bottomAnchor, constant: 28)
        ])
        // só mostra o indicador se a abertura passar de 1,5 s (no uso normal o catálogo abre antes)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, self.superview != nil, !self.isHidden else { return }
            self.espera.startAnimating()
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) não é usado") }

    func esconder() {
        guard !isHidden else { return }
        UIView.animate(withDuration: 0.25, animations: { self.alpha = 0 }, completion: { _ in
            self.isHidden = true
            self.espera.stopAnimating()
        })
    }
}

/// Tela "sem internet": aparece quando o catálogo não abre (na prática, só na primeira abertura sem conexão,
/// porque depois disso o service worker abre o catálogo guardado no aparelho). Tenta de novo sozinha quando a
/// internet volta.
final class SemInternetView: UIView {
    var aoTentarDeNovo: (() -> Void)?

    private let icone = UIImageView()
    private let titulo = UILabel()
    private let texto = UILabel()
    private let botao = UIButton(type: .system)
    private let rodape = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .mgAbertura

        let simbolo = UIImage.SymbolConfiguration(pointSize: 56, weight: .regular)
        icone.image = UIImage(systemName: "wifi.slash", withConfiguration: simbolo)
        icone.tintColor = .white
        icone.contentMode = .scaleAspectFit
        icone.isAccessibilityElement = false

        titulo.font = UIFont.preferredFont(forTextStyle: .title2).comNegrito()
        titulo.adjustsFontForContentSizeCategory = true
        titulo.textColor = .white
        titulo.textAlignment = .center
        titulo.numberOfLines = 0
        titulo.accessibilityTraits = .header

        texto.font = UIFont.preferredFont(forTextStyle: .body)
        texto.adjustsFontForContentSizeCategory = true
        texto.textColor = UIColor.white.withAlphaComponent(0.92)
        texto.textAlignment = .center
        texto.numberOfLines = 0

        var config = UIButton.Configuration.filled()
        config.title = "Tentar de novo"
        config.baseBackgroundColor = .white
        config.baseForegroundColor = UIColor(rgb: 0x0b4ea2)
        config.cornerStyle = .large
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { atributos in
            var novos = atributos
            novos.font = UIFont.preferredFont(forTextStyle: .headline)
            return novos
        }
        botao.configuration = config
        botao.addTarget(self, action: #selector(tocouTentar), for: .touchUpInside)

        rodape.font = UIFont.preferredFont(forTextStyle: .footnote)
        rodape.adjustsFontForContentSizeCategory = true
        rodape.textColor = UIColor.white.withAlphaComponent(0.8)
        rodape.textAlignment = .center
        rodape.numberOfLines = 0
        rodape.text = "Quando a internet voltar, o catálogo abre sozinho."

        let pilha = UIStackView(arrangedSubviews: [icone, titulo, texto, botao, rodape])
        pilha.axis = .vertical
        pilha.alignment = .center
        pilha.spacing = 16
        pilha.setCustomSpacing(24, after: icone)
        pilha.setCustomSpacing(28, after: texto)
        pilha.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pilha)
        NSLayoutConstraint.activate([
            icone.heightAnchor.constraint(equalToConstant: 64),
            pilha.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            pilha.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 32),
            pilha.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -32),
            titulo.widthAnchor.constraint(equalTo: pilha.widthAnchor),
            texto.widthAnchor.constraint(equalTo: pilha.widthAnchor),
            rodape.widthAnchor.constraint(equalTo: pilha.widthAnchor)
        ])
        mostrar(semRede: true)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) não é usado") }

    /// semRede: o aparelho está sem conexão; senão, a conexão existe mas o catálogo não respondeu.
    func mostrar(semRede: Bool) {
        if semRede {
            titulo.text = "Sem conexão com a internet"
            texto.text = "Para abrir pela primeira vez, o app precisa de internet para baixar o catálogo. Depois disso, ele funciona mesmo sem conexão."
        } else {
            titulo.text = "Não foi possível abrir o catálogo"
            texto.text = "Confira a conexão com a internet e toque em Tentar de novo."
        }
    }

    @objc private func tocouTentar() { aoTentarDeNovo?() }
}

private extension UIFont {
    func comNegrito() -> UIFont {
        guard let descritor = fontDescriptor.withSymbolicTraits(.traitBold) else { return self }
        return UIFont(descriptor: descritor, size: 0)
    }
}
