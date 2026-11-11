import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import { Cliente } from '../../app/models/cliente';
import { ClienteService } from '../../app/services/cliente.service';
import {
  formatarCep,
  formatarDocumento,
  formatarTelefone,
  rotuloTipoPessoa,
} from '../../app/utils/formatacao';

/** Dados completos de um cliente. */
@Component({
  selector: 'app-cliente-detalhe',
  imports: [RouterLink],
  templateUrl: './cliente-detalhe.html',
  styleUrls: ['../compartilhado/pagina.css', './cliente-detalhe.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClienteDetalhePage implements OnInit {
  private readonly clienteService = inject(ClienteService);

  /** Parâmetro de rota :id. */
  readonly id = input.required<string>();
  /** Query param ?aviso=cadastrado|atualizado vindo do formulário. */
  readonly aviso = input<string>();

  readonly cliente = signal<Cliente | null>(null);
  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly naoEncontrado = signal(false);

  readonly mensagemSucesso = computed(() => {
    switch (this.aviso()) {
      case 'cadastrado':
        return 'Cliente cadastrado com sucesso.';
      case 'atualizado':
        return 'Cliente atualizado com sucesso.';
      default:
        return null;
    }
  });

  readonly formatarDocumento = formatarDocumento;
  readonly formatarTelefone = formatarTelefone;
  readonly formatarCep = formatarCep;
  readonly rotuloTipoPessoa = rotuloTipoPessoa;

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    const id = Number(this.id());
    this.carregando.set(true);
    this.erro.set(null);
    this.naoEncontrado.set(false);

    if (!Number.isInteger(id) || id <= 0) {
      this.naoEncontrado.set(true);
      this.carregando.set(false);
      return;
    }

    this.clienteService.buscarPorId(id).subscribe({
      next: (cliente) => {
        this.cliente.set(cliente);
        this.carregando.set(false);
      },
      error: (erro: unknown) => {
        if (erro instanceof HttpErrorResponse && (erro.status === 404 || erro.status === 400)) {
          this.naoEncontrado.set(true);
        } else {
          this.erro.set(mensagemDeErro(erro));
        }
        this.carregando.set(false);
      },
    });
  }
}
