/* Site ON Guarese's Contabilidade: menu, tema, entrada dos blocos ao rolar,
   números, depoimentos e formulário de contato. Sem bibliotecas. */
(function () {
  "use strict";
  var raiz = document.documentElement;
  raiz.classList.add("js");
  var poucoMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Ano no rodapé */
  var ano = document.getElementById("ano");
  if (ano) ano.textContent = String(new Date().getFullYear());

  /* Topo: vira vidro ao rolar */
  var topo = document.getElementById("topo");
  var agendado = false;
  function aoRolar() {
    agendado = false;
    if (topo) topo.classList.toggle("rolado", (window.scrollY || 0) > 24);
  }
  window.addEventListener(
    "scroll",
    function () {
      if (!agendado) {
        agendado = true;
        window.requestAnimationFrame(aoRolar);
      }
    },
    { passive: true },
  );
  aoRolar();

  /* Menu no celular */
  var menu = document.getElementById("menu");
  var abrir = document.getElementById("abrir-menu");
  function fecharMenu() {
    if (!menu || !abrir) return;
    menu.classList.remove("aberto");
    abrir.setAttribute("aria-expanded", "false");
    abrir.setAttribute("aria-label", "Abrir o menu");
  }
  if (menu && abrir) {
    abrir.addEventListener("click", function () {
      var aberto = menu.classList.toggle("aberto");
      abrir.setAttribute("aria-expanded", aberto ? "true" : "false");
      abrir.setAttribute("aria-label", aberto ? "Fechar o menu" : "Abrir o menu");
    });
    menu.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("a")) fecharMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") fecharMenu();
    });
  }

  /* Seção atual destacada no menu */
  var links = Array.prototype.slice.call(document.querySelectorAll('.menu a[href^="#"]'));
  if ("IntersectionObserver" in window && links.length) {
    var porId = {};
    links.forEach(function (a) {
      porId[a.getAttribute("href").slice(1)] = a;
    });
    var obsMenu = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (en) {
          var a = porId[en.target.id];
          if (a && en.isIntersecting) {
            links.forEach(function (l) {
              l.classList.remove("ativo");
            });
            a.classList.add("ativo");
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    Object.keys(porId).forEach(function (id) {
      var s = document.getElementById(id);
      if (s) obsMenu.observe(s);
    });
  }

  /* Tema: claro (padrão, como a logo) ou escuro, guardado no aparelho */
  var botaoTema = document.getElementById("alternar-tema");
  function rotuloTema() {
    if (!botaoTema) return;
    var escuro = raiz.classList.contains("escuro");
    botaoTema.setAttribute("aria-label", escuro ? "Trocar para o modo claro" : "Trocar para o modo escuro");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", escuro ? "#171412" : "#ffffff");
  }
  if (botaoTema) {
    rotuloTema();
    botaoTema.addEventListener("click", function () {
      var escuro = raiz.classList.toggle("escuro");
      try {
        localStorage.setItem("tema", escuro ? "escuro" : "claro");
      } catch (e) {
        /* sem armazenamento: vale só nesta visita */
      }
      rotuloTema();
    });
  }

  /* Topo: as serras do fundo ondulam devagar (canvas leve, 30 quadros por segundo).
     Só com movimento liberado no aparelho; para quando o topo sai da tela. */
  var heroi = document.querySelector(".heroi");
  var tela = document.getElementById("heroi-ondas");
  var ctx = tela && tela.getContext ? tela.getContext("2d") : null;
  if (heroi && ctx && !poucoMovimento) {
    // Cada camada: distância da base até o pé, amplitude, cores (alto e pé) e ondas [repetições no período, peso, fase, velocidade]
    var camadas = [
      { base: 324, amp: 63, cores: ["#8a817a", "#5e5650"], ondas: [[2, 0.55, 0.3, 0.07], [5, 0.3, 1.7, -0.11], [11, 0.15, 0.4, 0.16]] },
      { base: 279, amp: 77, cores: ["#5e5650", "#433c37"], ondas: [[1, 0.5, 1.9, -0.09], [4, 0.35, 0.6, 0.14], [9, 0.15, 2.5, -0.2]] },
      { base: 230, amp: 86, cores: ["#433c37", "#2b2622"], ondas: [[2, 0.55, 3.1, 0.12], [3, 0.3, 0.9, -0.17], [7, 0.15, 1.3, 0.24]] },
      { base: 167, amp: 99, cores: ["#24201c", "#100e0c"], ondas: [[1, 0.5, 4.4, -0.15], [3, 0.35, 2.2, 0.21], [6, 0.15, 0.2, -0.3]] },
    ];
    var larg = 0;
    var alt = 0;
    var periodo = 1600;
    var tempo = 0;
    var anterior = 0;
    var ultimoQuadro = 0;
    var quadro = 0;
    var rodando = false;
    var DOIS_PI = Math.PI * 2;
    var medirTela = function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      larg = tela.clientWidth;
      alt = tela.clientHeight;
      tela.width = Math.round(larg * dpr);
      tela.height = Math.round(alt * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      periodo = Math.max(1100, Math.min(1760, larg * 1.1));
      camadas.forEach(function (c) {
        c.grad = ctx.createLinearGradient(0, alt - c.base - c.amp, 0, alt);
        c.grad.addColorStop(0, c.cores[0]);
        c.grad.addColorStop(1, c.cores[1]);
      });
    };
    var desenhar = function () {
      ctx.clearRect(0, 0, larg, alt);
      var passoX = 8;
      camadas.forEach(function (c) {
        var pe = alt - c.base;
        ctx.beginPath();
        ctx.moveTo(0, alt);
        for (var x = 0; x <= larg + passoX; x += passoX) {
          var s = 0;
          for (var i = 0; i < c.ondas.length; i++) {
            var o = c.ondas[i];
            s += o[1] * Math.sin((DOIS_PI * o[0] * x) / periodo + o[2] + o[3] * tempo);
          }
          ctx.lineTo(x, pe - c.amp * s);
        }
        ctx.lineTo(larg, alt);
        ctx.closePath();
        ctx.fillStyle = c.grad;
        ctx.fill();
      });
      // Lago no pé, com um reflexo claro que brilha devagar
      var lagoAlt = 146;
      var lago = ctx.createLinearGradient(0, alt - lagoAlt, 0, alt);
      lago.addColorStop(0, "rgba(233, 227, 221, 0)");
      lago.addColorStop(0.12, "rgba(233, 227, 221, 0.42)");
      lago.addColorStop(0.45, "rgba(57, 49, 43, 0.28)");
      lago.addColorStop(1, "rgba(14, 12, 11, 0)");
      ctx.fillStyle = lago;
      ctx.fillRect(0, alt - lagoAlt, larg, lagoAlt);
      ctx.save();
      ctx.translate(larg * 0.68, alt - 85);
      ctx.scale(1, 0.05);
      var reflexo = ctx.createRadialGradient(0, 0, 0, 0, 0, 230);
      reflexo.addColorStop(0, "rgba(244, 240, 235, " + (0.3 + 0.08 * Math.sin(tempo * 0.6)) + ")");
      reflexo.addColorStop(1, "rgba(244, 240, 235, 0)");
      ctx.fillStyle = reflexo;
      ctx.fillRect(-230, -230, 460, 460);
      ctx.restore();
    };
    var passo = function (agora) {
      if (!rodando) return;
      // Tempo contado só com o topo na tela (sem saltos ao voltar)
      tempo += Math.min((agora - anterior) / 1000, 0.1);
      anterior = agora;
      if (agora - ultimoQuadro >= 33) {
        ultimoQuadro = agora;
        desenhar();
      }
      quadro = window.requestAnimationFrame(passo);
    };
    var iniciar = function () {
      if (rodando) return;
      rodando = true;
      anterior = performance.now();
      quadro = window.requestAnimationFrame(passo);
    };
    var parar = function () {
      rodando = false;
      window.cancelAnimationFrame(quadro);
    };
    medirTela();
    desenhar();
    // As ondas aparecem aos poucos; depois a paisagem parada sai e fica só o céu
    var trocarFundo = function () {
      heroi.classList.add("ondas-ativas");
    };
    tela.addEventListener("transitionend", trocarFundo, { once: true });
    window.setTimeout(trocarFundo, 1500);
    window.requestAnimationFrame(function () {
      tela.classList.add("visivel");
    });
    var agendadoTela = false;
    window.addEventListener("resize", function () {
      if (agendadoTela) return;
      agendadoTela = true;
      window.requestAnimationFrame(function () {
        agendadoTela = false;
        medirTela();
        desenhar();
      });
    }, { passive: true });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entradas) {
        if (entradas[0].isIntersecting) iniciar();
        else parar();
      }).observe(heroi);
    } else {
      iniciar();
    }
  }

  /* Blocos aparecem ao rolar (em cascata dentro de cada grupo) */
  var revelar = Array.prototype.slice.call(document.querySelectorAll("[data-revelar]"));
  revelar.forEach(function (el) {
    var irmaos = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (c) {
      return c.hasAttribute("data-revelar");
    }) : [];
    var i = irmaos.indexOf(el);
    if (i > 0) el.style.setProperty("--atraso", Math.min(i * 0.08, 0.5) + "s");
  });
  if ("IntersectionObserver" in window && !poucoMovimento) {
    var obs = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("visivel");
            obs.unobserve(en.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    revelar.forEach(function (el) {
      obs.observe(el);
    });
  } else {
    revelar.forEach(function (el) {
      el.classList.add("visivel");
    });
  }

  /* Números: a faixa só aparece com todos os valores preenchidos (reais) */
  var numeros = document.getElementById("numeros");
  if (numeros) {
    var alvos = Array.prototype.slice.call(numeros.querySelectorAll("[data-alvo]"));
    var completos = alvos.length && alvos.every(function (n) {
      return /^\d+$/.test(n.getAttribute("data-alvo") || "");
    });
    if (completos) {
      numeros.hidden = false;
      var contar = function (n) {
        var fim = Number(n.getAttribute("data-alvo"));
        var sufixo = n.getAttribute("data-sufixo") || "";
        if (poucoMovimento) {
          n.textContent = fim.toLocaleString("pt-BR") + sufixo;
          return;
        }
        var inicio = null;
        var passo = function (t) {
          if (inicio === null) inicio = t;
          var p = Math.min(1, (t - inicio) / 1600);
          var v = Math.round(fim * (1 - Math.pow(1 - p, 3)));
          n.textContent = v.toLocaleString("pt-BR") + (p === 1 ? sufixo : "");
          if (p < 1) window.requestAnimationFrame(passo);
        };
        window.requestAnimationFrame(passo);
      };
      if ("IntersectionObserver" in window) {
        var obsNum = new IntersectionObserver(
          function (entradas) {
            entradas.forEach(function (en) {
              if (en.isIntersecting) {
                contar(en.target);
                obsNum.unobserve(en.target);
              }
            });
          },
          { threshold: 0.5 },
        );
        alvos.forEach(function (n) {
          obsNum.observe(n);
        });
      } else {
        alvos.forEach(contar);
      }
    }
  }

  /* Depoimentos: a seção só aparece com depoimentos reais cadastrados no HTML */
  var trilho = document.getElementById("depoimentos-trilho");
  var secaoDep = document.getElementById("depoimentos");
  if (trilho && secaoDep) {
    var itens = trilho.querySelectorAll(".depoimento");
    if (itens.length) {
      secaoDep.hidden = false;
      var pontos = document.getElementById("depoimentos-pontos");
      var atual = 0;
      var mostrar = function (i) {
        atual = (i + itens.length) % itens.length;
        trilho.style.transform = "translateX(" + -atual * 100 + "%)";
        Array.prototype.forEach.call(pontos.children, function (b, j) {
          b.setAttribute("aria-current", j === atual ? "true" : "false");
        });
        Array.prototype.forEach.call(itens, function (it, j) {
          it.setAttribute("aria-hidden", j === atual ? "false" : "true");
        });
      };
      Array.prototype.forEach.call(itens, function (_, j) {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-label", "Depoimento " + (j + 1));
        b.addEventListener("click", function () {
          mostrar(j);
        });
        pontos.appendChild(b);
      });
      document.getElementById("depoimento-anterior").addEventListener("click", function () {
        mostrar(atual - 1);
      });
      document.getElementById("depoimento-proximo").addEventListener("click", function () {
        mostrar(atual + 1);
      });
      mostrar(0);
      if (!poucoMovimento && itens.length > 1) {
        var intervalo = window.setInterval(function () {
          mostrar(atual + 1);
        }, 7000);
        secaoDep.addEventListener("pointerenter", function () {
          window.clearInterval(intervalo);
        });
      }
    }
  }

  /* Formulário de contato: envia pelo servidor do portal para o e-mail do escritório.
     Se o envio não der certo, oferece o WhatsApp e o e-mail com a mensagem já escrita. */
  var form = document.getElementById("formulario-contato");
  if (form) {
    var inicioForm = Date.now();
    var status = document.getElementById("formulario-status");
    var alternativa = document.getElementById("formulario-alternativa");
    var botao = form.querySelector('button[type="submit"]');
    var valor = function (nome) {
      var c = form.elements[nome];
      return c ? String(c.value || "").trim() : "";
    };
    var avisar = function (texto, tipo) {
      status.textContent = texto;
      status.className = "formulario-status" + (tipo ? " " + tipo : "");
    };
    var montarAlternativas = function () {
      var texto =
        "Olá! Vim pelo site da ON Guarese's.\n" +
        "Nome: " + valor("nome") + "\n" +
        (valor("empresa") ? "Empresa: " + valor("empresa") + "\n" : "") +
        "Assunto: " + valor("assunto") + "\n\n" + valor("mensagem");
      document.getElementById("alternativa-whats").href = "https://wa.me/5563992969763?text=" + encodeURIComponent(texto);
      document.getElementById("alternativa-email").href =
        "mailto:onguaresescontato@gmail.com?subject=" + encodeURIComponent("Contato pelo site — " + valor("assunto")) + "&body=" + encodeURIComponent(texto);
      alternativa.hidden = false;
    };
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var obrigatorios = ["nome", "email", "mensagem"];
      var primeiro = null;
      obrigatorios.forEach(function (n) {
        var c = form.elements[n];
        var ok = valor(n).length > 0 && (n !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor(n)));
        c.setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok && !primeiro) primeiro = c;
      });
      if (primeiro) {
        avisar("Preencha nome, um e-mail válido e a mensagem.", "erro");
        primeiro.focus();
        return;
      }
      if (!form.elements.consentimento.checked) {
        avisar("Marque a concordância com o uso dos dados para podermos responder.", "erro");
        form.elements.consentimento.focus();
        return;
      }
      botao.disabled = true;
      avisar("Enviando...", "");
      alternativa.hidden = true;
      var dados = {
        nome: valor("nome"),
        email: valor("email"),
        telefone: valor("telefone"),
        empresa: valor("empresa"),
        assunto: valor("assunto"),
        mensagem: valor("mensagem"),
        consentimento: true,
        site: valor("site"),
        tempo: Date.now() - inicioForm,
      };
      fetch(form.getAttribute("data-api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      })
        .then(function (r) {
          return r
            .json()
            .catch(function () {
              return {};
            })
            .then(function (j) {
              return { ok: r.ok, j: j };
            });
        })
        .then(function (res) {
          if (res.ok && res.j && res.j.ok) {
            avisar("Mensagem enviada! Vamos responder em breve pelo e-mail ou pelo WhatsApp informado.", "ok");
            form.reset();
            inicioForm = Date.now();
          } else {
            avisar((res.j && res.j.mensagem) || "Não foi possível enviar por aqui agora. Use um dos botões abaixo: a mensagem já vai escrita.", "erro");
            montarAlternativas();
          }
        })
        .catch(function () {
          avisar("Não foi possível enviar por aqui agora. Use um dos botões abaixo: a mensagem já vai escrita.", "erro");
          montarAlternativas();
        })
        .then(function () {
          botao.disabled = false;
        });
    });
  }
})();
