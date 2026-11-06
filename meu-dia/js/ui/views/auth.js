// Cadastro, login, recuperação e troca de senha.
import { html, useState } from '../../vendor/preact.js';
import { Button, TextInput, SheetHeader, Hint, Icon } from '../components.js';
import { openSheet, replaceSheet, toast } from '../state.js';
import { signIn, signUp, sendPasswordReset, setNewPassword, friendlyError, cancelRecovery } from '../../services/cloud.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function passwordProblem(pw) {
  if (pw.length < 8) return 'Use pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Misture letras e números.';
  return '';
}

function AuthForm({ mode: initialMode, onClose }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(null);

  const titles = {
    login: ['Entrar', 'Use seu e-mail e senha.'],
    signup: ['Criar conta', 'Para sincronizar entre celular e computador.'],
    forgot: ['Recuperar senha', 'Enviaremos um link para criar uma nova senha.'],
    change: ['Trocar senha', 'Escolha uma senha nova.'],
    recovery: ['Nova senha', 'Crie uma senha nova para sua conta.'],
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    const needsEmail = ['login', 'signup', 'forgot'].includes(mode);
    const needsPassword = mode !== 'forgot';
    if (needsEmail && !EMAIL_RE.test(email.trim())) errs.email = 'Digite um e-mail válido.';
    if (needsPassword) {
      if (mode === 'login') {
        if (!password) errs.password = 'Digite sua senha.';
      } else {
        const p = passwordProblem(password);
        if (p) errs.password = p;
        else if (password !== password2) errs.password2 = 'As senhas não conferem.';
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn({ email: email.trim(), password });
        toast('Bem-vindo de volta!', { tone: 'success' });
        onClose();
      } else if (mode === 'signup') {
        const { needsConfirmation } = await signUp({ email: email.trim(), password, name: name.trim() });
        if (needsConfirmation) setDone({ icon: 'mail', title: 'Confirme seu e-mail', text: `Enviamos um link para ${email.trim()}. Abra o e-mail e toque no link para ativar a conta. Depois é só entrar.` });
        else {
          toast('Conta criada!', { tone: 'success' });
          onClose();
        }
      } else if (mode === 'forgot') {
        await sendPasswordReset(email.trim());
        setDone({ icon: 'mail', title: 'Verifique seu e-mail', text: `Se existir uma conta para ${email.trim()}, você receberá um link para criar uma nova senha. Abra-o neste aparelho.` });
      } else {
        await setNewPassword(password);
        toast('Senha atualizada', { tone: 'success' });
        onClose();
      }
    } catch (err) {
      setErrors({ form: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return html`<div class="form">
      <${SheetHeader} title=${done.title} onClose=${onClose} />
      <div class="empty" style=${{ paddingTop: 0 }}>
        <div class="empty-icon"><${Icon} name=${done.icon} size=${26} /></div>
        <p class="empty-text" style=${{ maxWidth: '40ch' }}>${done.text}</p>
      </div>
      <${Button} size="lg" onClick=${onClose}>Entendi</${Button}>
    </div>`;
  }

  const [title, subtitle] = titles[mode];
  const close = () => {
    if (mode === 'recovery') cancelRecovery();
    onClose();
  };
  return html`<form class="form" onSubmit=${submit} novalidate>
    <${SheetHeader} title=${title} subtitle=${subtitle} onClose=${close} />
    ${mode === 'signup' && html`<${TextInput} label="Seu nome (opcional)" value=${name} onInput=${setName} autocomplete="given-name" maxlength="40" />`}
    ${['login', 'signup', 'forgot'].includes(mode) &&
    html`<${TextInput}
      label="E-mail"
      type="email"
      inputmode="email"
      autocomplete=${mode === 'signup' ? 'email' : 'username'}
      autocapitalize="off"
      spellcheck="false"
      value=${email}
      onInput=${setEmail}
      error=${errors.email}
      autofocus
    />`}
    ${mode !== 'forgot' &&
    html`<${TextInput}
      label=${mode === 'login' ? 'Senha' : 'Nova senha'}
      type=${show ? 'text' : 'password'}
      autocomplete=${mode === 'login' ? 'current-password' : 'new-password'}
      value=${password}
      onInput=${setPassword}
      error=${errors.password}
      hint=${mode === 'login' ? undefined : 'Pelo menos 8 caracteres, com letras e números.'}
      autofocus=${mode === 'change' || mode === 'recovery'}
    />`}
    ${['signup', 'change', 'recovery'].includes(mode) &&
    html`<${TextInput}
      label="Repita a senha"
      type=${show ? 'text' : 'password'}
      autocomplete="new-password"
      value=${password2}
      onInput=${setPassword2}
      error=${errors.password2}
    />`}
    ${mode !== 'forgot' &&
    html`<label class="toggle-row" style=${{ minHeight: '40px' }}>
      <span class="toggle-label" style=${{ fontWeight: 600, fontSize: '15px' }}>Mostrar senha</span>
      <input type="checkbox" class="toggle" checked=${show} onChange=${(e) => setShow(e.currentTarget.checked)} />
    </label>`}
    ${errors.form && html`<p class="field-error" role="alert">${errors.form}</p>`}
    <${Button} type="submit" size="lg" disabled=${busy}>
      ${busy ? 'Aguarde…' : { login: 'Entrar', signup: 'Criar conta', forgot: 'Enviar link', change: 'Salvar senha', recovery: 'Salvar nova senha' }[mode]}
    </${Button}>
    ${mode === 'login' &&
    html`<div class="row-actions">
      <${Button} variant="ghost" onClick=${() => setMode('forgot')}>Esqueci minha senha</${Button}>
      <${Button} variant="ghost" onClick=${() => setMode('signup')}>Criar conta</${Button}>
    </div>`}
    ${mode === 'signup' && html`<${Button} variant="ghost" onClick=${() => setMode('login')}>Já tenho conta</${Button}>`}
    ${mode === 'forgot' && html`<${Button} variant="ghost" onClick=${() => setMode('login')}>Voltar para entrar</${Button}>`}
    ${mode === 'signup' && html`<${Hint} icon="lock">Seus dados ficam protegidos e só você tem acesso a eles.</${Hint}>`}
  </form>`;
}

export function openAuthSheet(mode = 'login', { replace = false } = {}) {
  const render = (close) => html`<${AuthForm} mode=${mode} onClose=${close} />`;
  return replace ? replaceSheet(render) : openSheet(render);
}
