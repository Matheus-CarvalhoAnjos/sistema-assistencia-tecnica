import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../app/auth/auth.service';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import { PerfilUsuario } from '../../app/models/usuario-autenticado';
import { ROTULOS_PERFIL, Usuario, UsuarioEntrada } from '../../app/models/usuario';
import { FiltrosUsuario, UsuarioService } from '../../app/services/usuario.service';
import { Mensagem, MensagemAcao } from '../ordens-servico/secoes/mensagem-acao';

/** Política mínima de senha (igual à do backend, usuarioService). */
const SENHA_TAMANHO_MINIMO = 8;
const SENHA_TAMANHO_MAXIMO = 72;
const VALIDACAO_SENHA = [Validators.minLength(SENHA_TAMANHO_MINIMO), Validators.maxLength(SENHA_TAMANHO_MAXIMO)];

/**
 * Gestão de usuários (somente ADMINISTRADOR; a rota e a API conferem).
 * A senha nunca é exibida: no cadastro é obrigatória e na edição só é enviada quando preenchida.
 * A API impede que o sistema fique sem administrador ativo.
 */
@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule, MensagemAcao],
  templateUrl: './usuarios.html',
  styleUrls: ['../compartilhado/pagina.css', '../ordens-servico/secoes/secoes.css', './usuarios.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosPage implements OnInit {
  private readonly servico = inject(UsuarioService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly perfis = Object.entries(ROTULOS_PERFIL) as [PerfilUsuario, string][];
  readonly rotulosPerfil = ROTULOS_PERFIL;

  readonly usuarios = signal<Usuario[]>([]);
  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly filtros = signal<FiltrosUsuario>({ perfil: '', ativo: '' });

  /** null = formulário fechado; 0 = novo usuário; id = edição. */
  readonly editando = signal<number | null>(null);
  readonly confirmandoAtivo = signal<number | null>(null);
  readonly enviando = signal(false);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly idLogado = computed(() => this.auth.usuario()?.id_usuario ?? null);
  readonly emEdicao = computed(() => {
    const id = this.editando();
    return id ? this.usuarios().find((u) => u.id_usuario === id) ?? null : null;
  });

  readonly form = this.fb.group({
    nome: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
    perfil: ['TECNICO' as PerfilUsuario, Validators.required],
    senha: [''],
  });

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.servico.listar(this.filtros()).subscribe({
      next: (lista) => {
        this.usuarios.set(lista);
        this.carregando.set(false);
      },
      error: (erro: unknown) => {
        this.erro.set(mensagemDeErro(erro));
        this.carregando.set(false);
      },
    });
  }

  aoFiltrar(campo: keyof FiltrosUsuario, evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.filtros.update((f) => ({ ...f, [campo]: valor }));
    this.carregar();
  }

  ativo(usuario: Usuario): boolean {
    return Number(usuario.ativo) === 1 || usuario.ativo === true;
  }

  abrirNovo(): void {
    this.form.reset({ nome: '', email: '', perfil: 'TECNICO', senha: '' });
    this.form.controls.senha.setValidators([Validators.required, ...VALIDACAO_SENHA]);
    this.form.controls.senha.updateValueAndValidity();
    this.mensagem.set(null);
    this.editando.set(0);
  }

  abrirEdicao(usuario: Usuario): void {
    this.form.reset({ nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, senha: '' });
    // Na edição a senha é opcional; se preenchida, segue a mesma regra do cadastro
    this.form.controls.senha.setValidators(VALIDACAO_SENHA);
    this.form.controls.senha.updateValueAndValidity();
    this.mensagem.set(null);
    this.editando.set(usuario.id_usuario);
  }

  fecharFormulario(): void {
    this.editando.set(null);
  }

  salvar(): void {
    if (this.form.invalid || this.enviando()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const dados: UsuarioEntrada = { nome: v.nome.trim(), email: v.email.trim(), perfil: v.perfil };
    if (v.senha) dados.senha = v.senha;

    const id = this.editando();
    const requisicao = id ? this.servico.atualizar(id, dados) : this.servico.criar(dados);

    this.enviando.set(true);
    this.mensagem.set(null);
    requisicao.subscribe({
      next: (resposta) => {
        this.enviando.set(false);
        this.editando.set(null);
        this.mensagem.set({ tipo: 'sucesso', texto: `${resposta.mensagem} (${resposta.usuario.nome})` });
        this.carregar();
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }

  confirmarAtivo(usuario: Usuario): void {
    const novo = !this.ativo(usuario);
    this.enviando.set(true);
    this.mensagem.set(null);
    this.servico.alterarAtivo(usuario.id_usuario, novo).subscribe({
      next: (resposta) => {
        this.enviando.set(false);
        this.confirmandoAtivo.set(null);
        this.mensagem.set({ tipo: 'sucesso', texto: `${resposta.mensagem} (${resposta.usuario.nome})` });
        this.carregar();
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.confirmandoAtivo.set(null);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }

  /** Mensagem do campo senha conforme o erro (mesma regra do backend: 8 a 72 caracteres). */
  erroSenha(): string {
    const erros = this.form.controls.senha.errors;
    if (erros?.['minlength']) return `A senha deve ter pelo menos ${SENHA_TAMANHO_MINIMO} caracteres.`;
    if (erros?.['maxlength']) return `A senha deve ter no máximo ${SENHA_TAMANHO_MAXIMO} caracteres.`;
    return 'Informe a senha.';
  }

  invalido(campo: 'nome' | 'email' | 'senha'): boolean {
    const c = this.form.controls[campo];
    return c.invalid && c.touched;
  }
}
