import UIKit
import WebKit
import Network

/// A tela do app: o catálogo https://mgpecasautomotivas.github.io/ num WKWebView, com os toques nativos do iPhone:
/// - links para outros sites (WhatsApp, site da MG, Mercado Livre…) abrem fora do app (Safari ou o app de cada um);
/// - "Imprimir / PDF" abre a impressão do iPhone (imprimir ou salvar em PDF);
/// - "Compartilhar" abre a folha de compartilhar do iPhone;
/// - arquivos baixados pela página (QR code em PNG/SVG) vão para a folha de compartilhar (salvar em Arquivos, Fotos…);
/// - tela de abertura com o logo e tela "sem internet" na primeira abertura sem conexão, que tenta de novo sozinha.
/// O service worker do catálogo (offline) funciona porque o domínio do app está em WKAppBoundDomains (Info.plist).
final class WebViewController: UIViewController {

    static let hostDoApp = "mgpecasautomotivas.github.io"
    static let enderecoInicial = URL(string: "https://mgpecasautomotivas.github.io/")!

    private var webView: WKWebView!
    private let abertura = AberturaView()
    private let semInternet = SemInternetView()
    private let monitorRede = NWPathMonitor()
    private var temRede = true
    private var destinosDeDownload: [ObjectIdentifier: URL] = [:]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - montagem

    override func loadView() {
        let configuracao = WKWebViewConfiguration()
        // App-Bound Domains: liga o service worker no WKWebView. Com isso o WKWebView só navega nos domínios do
        // Info.plist; os outros endereços são abertos fora do app (veja decidePolicyFor).
        configuracao.limitsNavigationsToAppBoundDomains = true
        configuracao.websiteDataStore = .default()
        configuracao.dataDetectorTypes = []
        // identificação do navegador: a padrão do iPhone ("... Mobile/15E148") + a marca do app da loja
        let nomePadrao = WKWebViewConfiguration().applicationNameForUserAgent ?? ""
        configuracao.applicationNameForUserAgent = [nomePadrao, "MGCatalogoApp-iOS"]
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        let conteudo = WKUserContentController()
        // marca do app da loja para a página (esconde os convites para "instalar o app")
        conteudo.addUserScript(WKUserScript(source: "window.MG_APP_LOJA = 'ios';",
                                            injectionTime: .atDocumentStart,
                                            forMainFrameOnly: true))
        if let ponte = Self.lerPonte() {
            conteudo.addUserScript(WKUserScript(source: ponte, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        conteudo.add(MensageiroFraco(self), name: "mgApp")
        configuracao.userContentController = conteudo

        let web = WKWebView(frame: .zero, configuration: configuracao)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true   // deslizar da borda volta para a tela anterior
        web.allowsLinkPreview = false
        web.isOpaque = false
        web.backgroundColor = .mgFundo
        web.scrollView.backgroundColor = .mgFundo
        // a página desenha atrás da barra de status e da barra de início (viewport-fit=cover + env(safe-area-inset-*))
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        webView = web

        let raiz = UIView()
        raiz.backgroundColor = .mgFundo
        for v in [web, semInternet, abertura] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            raiz.addSubview(v)
            NSLayoutConstraint.activate([
                v.topAnchor.constraint(equalTo: raiz.topAnchor),
                v.bottomAnchor.constraint(equalTo: raiz.bottomAnchor),
                v.leadingAnchor.constraint(equalTo: raiz.leadingAnchor),
                v.trailingAnchor.constraint(equalTo: raiz.trailingAnchor)
            ])
        }
        semInternet.isHidden = true
        semInternet.aoTentarDeNovo = { [weak self] in self?.tentarDeNovo() }
        view = raiz
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        monitorRede.pathUpdateHandler = { [weak self] caminho in
            let ok = caminho.status == .satisfied
            DispatchQueue.main.async { self?.redeMudou(ok) }
        }
        monitorRede.start(queue: DispatchQueue(label: "br.com.mgpecasautomotivas.catalogo.rede"))
        var inicial = Self.enderecoInicial
        #if DEBUG
        if let teste = Self.enderecoDeTeste() { inicial = teste }
        #endif
        webView.load(URLRequest(url: inicial))
        // segurança: a abertura nunca fica presa na tela (se a página demorar muito, ela aparece mesmo assim)
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in self?.abertura.esconder() }
    }

    deinit { monitorRede.cancel() }

    private static func lerPonte() -> String? {
        guard let url = Bundle.main.url(forResource: "ponte", withExtension: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    // MARK: - sem internet

    private func redeMudou(_ ok: Bool) {
        temRede = ok
        guard !semInternet.isHidden else { return }
        semInternet.mostrar(semRede: !ok)
        if ok { tentarDeNovo() }   // a internet voltou com a tela "sem internet" aberta: abre o catálogo sozinho
    }

    private func mostrarSemInternet() {
        semInternet.mostrar(semRede: !temRede)
        semInternet.isHidden = false
        abertura.esconder()
        UIAccessibility.post(notification: .screenChanged, argument: semInternet)
    }

    private func tentarDeNovo() {
        semInternet.isHidden = true
        let alvo = webView.url.flatMap { ehDoApp($0) ? $0 : nil } ?? Self.enderecoInicial
        webView.load(URLRequest(url: alvo))
    }

    // MARK: - links, impressão e compartilhamento

    fileprivate func ehDoApp(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == Self.hostDoApp
    }

    fileprivate func abrirFora(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func imprimir(titulo: String) {
        let impressao = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = titulo.isEmpty ? "MG Peças" : titulo
        impressao.printInfo = info
        // o formatador do WKWebView usa o CSS @media print da página (a folha limpa montada pelo catálogo)
        impressao.printFormatter = webView.viewPrintFormatter()
        impressao.present(animated: true) { [weak self] _, _, _ in
            self?.webView.evaluateJavaScript("window.__mgImpressaoFechada && window.__mgImpressaoFechada()",
                                             completionHandler: nil)
        }
    }

    private func compartilhar(id: Int, titulo: String, texto: String, endereco: String) {
        var itens: [Any] = []
        let textoLimpo = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if !textoLimpo.isEmpty { itens.append(TextoParaCompartilhar(texto: textoLimpo, assunto: titulo)) }
        if !endereco.isEmpty, let url = URL(string: endereco) { itens.append(url) }
        if itens.isEmpty {
            itens.append(TextoParaCompartilhar(texto: titulo.isEmpty ? Self.enderecoInicial.absoluteString : titulo,
                                               assunto: titulo))
        }
        let folha = UIActivityViewController(activityItems: itens, applicationActivities: nil)
        folha.completionWithItemsHandler = { [weak self] _, concluido, _, erro in
            let resultado = concluido ? "null" : (erro == nil ? "'cancelado'" : "'erro'")
            self?.webView.evaluateJavaScript("window.__mgCompartilhamentoFim && window.__mgCompartilhamentoFim(\(id), \(resultado))",
                                             completionHandler: nil)
        }
        apresentar(folha) { [weak self] in
            self?.webView.evaluateJavaScript("window.__mgCompartilhamentoFim && window.__mgCompartilhamentoFim(\(id), 'erro')",
                                             completionHandler: nil)
        }
    }

    /// Apresenta por cima do que estiver aberto. Se não der (outra folha saindo, tela fora da janela), chama seNaoDer.
    fileprivate func apresentar(_ controlador: UIViewController, seNaoDer: (() -> Void)? = nil) {
        guard viewIfLoaded?.window != nil else { seNaoDer?(); return }
        var topo: UIViewController = self
        while let acima = topo.presentedViewController { topo = acima }
        if topo.isBeingDismissed || topo.isBeingPresented { seNaoDer?(); return }
        if let pop = controlador.popoverPresentationController {
            pop.sourceView = topo.view
            pop.sourceRect = CGRect(x: topo.view.bounds.midX, y: topo.view.bounds.maxY - 1, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        topo.present(controlador, animated: true)
    }
}

// MARK: - mensagens da página (ponte.js)

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // só aceita mensagens do próprio catálogo, no quadro principal
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() == Self.hostDoApp,
              let corpo = message.body as? [String: Any],
              let tipo = corpo["tipo"] as? String else { return }
        switch tipo {
        case "imprimir":
            imprimir(titulo: corpo["titulo"] as? String ?? "")
        case "compartilhar":
            compartilhar(id: (corpo["id"] as? NSNumber)?.intValue ?? 0,
                         titulo: corpo["titulo"] as? String ?? "",
                         texto: corpo["texto"] as? String ?? "",
                         endereco: corpo["url"] as? String ?? "")
        default:
            break
        }
    }
}

// MARK: - navegação

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor acao: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = acao.request.url else { decisionHandler(.cancel); return }
        if acao.shouldPerformDownload { decisionHandler(.download); return }
        let esquema = url.scheme?.lowercased() ?? ""
        if esquema == "about" || esquema == "blob" || esquema == "data" { decisionHandler(.allow); return }
        guard let quadro = acao.targetFrame else {
            // link com target="_blank" ou window.open: o catálogo abre aqui mesmo; o resto, fora do app
            if ehDoApp(url) { webView.load(acao.request) } else { abrirFora(url) }
            decisionHandler(.cancel)
            return
        }
        if !quadro.isMainFrame || ehDoApp(url) { decisionHandler(.allow); return }
        abrirFora(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor resposta: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(resposta.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        semInternet.isHidden = true
        abertura.esconder()
        #if DEBUG
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.diagnosticoSePedido() }
        #endif
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        falhou(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        falhou(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // o sistema fechou o processo da página (pouca memória): abre de novo onde estava
        if let atual = webView.url, ehDoApp(atual) { webView.load(URLRequest(url: atual)) } else { webView.load(URLRequest(url: Self.enderecoInicial)) }
    }

    private func falhou(_ error: Error) {
        let erro = error as NSError
        // cancelamentos (outro link tocado, download, link aberto fora do app) não são falha de conexão
        if erro.domain == NSURLErrorDomain && erro.code == NSURLErrorCancelled { return }
        if erro.domain == "WebKitErrorDomain" && (erro.code == 102 || erro.code == 101) { return }
        guard erro.domain == NSURLErrorDomain else { return }
        mostrarSemInternet()
    }
}

// MARK: - janelas, alertas e confirmações da página

extension WebViewController: WKUIDelegate {
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for acao: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = acao.request.url {
            if ehDoApp(url) { webView.load(acao.request) } else { abrirFora(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alerta = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        apresentar(alerta, seNaoDer: completionHandler)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alerta = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
        alerta.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        apresentar(alerta) { completionHandler(false) }
    }
}

// MARK: - arquivos baixados pela página

extension WebViewController: WKDownloadDelegate {
    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let pasta = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: pasta, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let nome = suggestedFilename.isEmpty ? "arquivo-mg" : suggestedFilename
        let destino = pasta.appendingPathComponent(nome)
        destinosDeDownload[ObjectIdentifier(download)] = destino
        completionHandler(destino)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destino = destinosDeDownload.removeValue(forKey: ObjectIdentifier(download)) else { return }
        apresentar(UIActivityViewController(activityItems: [destino], applicationActivities: nil))
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinosDeDownload.removeValue(forKey: ObjectIdentifier(download))
    }
}

// MARK: - apoio

/// O WKUserContentController segura o tratador com referência forte; este intermediário evita o ciclo.
private final class MensageiroFraco: NSObject, WKScriptMessageHandler {
    private weak var alvo: WKScriptMessageHandler?
    init(_ alvo: WKScriptMessageHandler) { self.alvo = alvo }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        alvo?.userContentController(userContentController, didReceive: message)
    }
}

/// Texto para a folha de compartilhar, com o título como assunto (e-mail).
private final class TextoParaCompartilhar: NSObject, UIActivityItemSource {
    private let texto: String
    private let assunto: String
    init(texto: String, assunto: String) {
        self.texto = texto
        self.assunto = assunto
    }
    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { texto }
    func activityViewController(_ activityViewController: UIActivityViewController,
                                itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { texto }
    func activityViewController(_ activityViewController: UIActivityViewController,
                                subjectForActivityType activityType: UIActivity.ActivityType?) -> String { assunto }
}

// MARK: - diagnóstico (só no build de teste, Debug)

#if DEBUG
extension WebViewController {
    /// Endereço de abertura para o teste no simulador: argumento "-mgEndereco <url do catálogo>".
    static func enderecoDeTeste() -> URL? {
        let argumentos = ProcessInfo.processInfo.arguments
        guard let i = argumentos.firstIndex(of: "-mgEndereco"), i + 1 < argumentos.count,
              let url = URL(string: argumentos[i + 1]), url.host?.lowercased() == hostDoApp else { return nil }
        return url
    }

    /// Com o argumento "-mgDiagnostico", escreve no console (stderr) o que a página vê: marca da loja, ponte,
    /// service worker, caches, fotos e fontes carregadas. Usado pelo teste no simulador do workflow ios.yml.
    func diagnosticoSePedido() {
        guard ProcessInfo.processInfo.arguments.contains("-mgDiagnostico") else { return }
        let js = """
        const r = { url: location.href, titulo: document.title, loja: window.MG_APP_LOJA || null,
          ua: navigator.userAgent, ponte: !!window.__mgPonteIOS, share: typeof navigator.share,
          print: String(window.print).indexOf('imprimir') >= 0, sw: 'serviceWorker' in navigator, online: navigator.onLine };
        try { r.controlador = !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) { r.controlador = 'erro: ' + e; }
        try { r.registros = navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0; } catch (e) { r.registros = 'erro: ' + e; }
        try { r.caches = await caches.keys(); } catch (e) { r.caches = 'erro: ' + e; }
        const imgs = Array.from(document.images);
        r.imagens = imgs.length;
        r.imagensOk = imgs.filter(function (i) { return i.complete && i.naturalWidth > 0; }).length;
        try { r.fonteBarlow = document.fonts.check('16px Barlow'); } catch (e) { r.fonteBarlow = 'erro: ' + e; }
        try { r.seguraTopo = getComputedStyle(document.documentElement).getPropertyValue('--sa-topo').trim(); } catch (e) {}
        r.tela = ((document.querySelector('main') || document.body).innerText || '').replace(/\\s+/g, ' ').slice(0, 240);
        return JSON.stringify(r);
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { resultado in
            let linha: String
            switch resultado {
            case .success(let valor): linha = "MG-DIAGNOSTICO \(valor)\n"
            case .failure(let erro): linha = "MG-DIAGNOSTICO-ERRO \(erro)\n"
            }
            FileHandle.standardError.write(Data(linha.utf8))
        }
    }
}
#endif
