import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../app/auth/auth.service';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Query params ligados por withComponentInputBinding. */
  readonly motivo = input<string>();
  readonly retorno = input<string>();

  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly tentouEnviar = signal(false);

  readonly avisoSessao = computed(() =>
    this.motivo() === 'expirada' ? 'Sua sessão expirou. Entre novamente para continuar.' : null,
  );

  readonly formulario = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required]],
  });

  campoInvalido(campo: 'email' | 'senha'): boolean {
    const controle = this.formulario.controls[campo];
    return controle.invalid && (controle.touched || this.tentouEnviar());
  }

  entrar(): void {
    this.tentouEnviar.set(true);
    this.erro.set(null);

    if (this.formulario.invalid || this.enviando()) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.enviando.set(true);

    this.auth.login(this.formulario.getRawValue()).subscribe({
      next: () => {
        void this.router.navigateByUrl(this.destinoSeguro());
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.erro.set(mensagemDeErro(erro));
        // Limpa a senha sem exibir "Informe a senha." junto da mensagem da API
        this.tentouEnviar.set(false);
        this.formulario.controls.senha.reset();
      },
    });
  }

  /** Aceita apenas caminhos internos para evitar redirecionamento para fora do sistema. */
  private destinoSeguro(): string {
    const retorno = this.retorno();
    return retorno && retorno.startsWith('/') && !retorno.startsWith('//') && !retorno.startsWith('/login')
      ? retorno
      : '/';
  }
}
