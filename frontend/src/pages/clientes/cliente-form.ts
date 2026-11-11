import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import { ClienteEntrada, TipoPessoa, UFS } from '../../app/models/cliente';
import { ClienteService } from '../../app/services/cliente.service';
import {
  formatarCep,
  formatarDocumento,
  formatarTelefone,
  somenteDigitos,
} from '../../app/utils/formatacao';

type CampoCliente = keyof ClienteEntrada;

/** CPF com 11 dígitos ou CNPJ com 14, conforme o tipo de pessoa do formulário. */
function documentoValido(controle: AbstractControl): ValidationErrors | null {
  const digitos = somenteDigitos(controle.value as string);
  if (!digitos) {
    return null; // "required" cuida do vazio
  }
  const tipo = controle.parent?.get('tipo_pessoa')?.value as TipoPessoa | undefined;
  const esperado = tipo === 'JURIDICA' ? 14 : 11;
  return digitos.length === esperado ? null : { documento: esperado };
}

function quantidadeDigitos(minimo: number, maximo: number) {
  return (controle: AbstractControl): ValidationErrors | null => {
    const digitos = somenteDigitos(controle.value as string);
    if (!digitos) {
      return null;
    }
    return digitos.length >= minimo && digitos.length <= maximo ? null : { digitos: true };
  };
}

const ROTULOS: Record<CampoCliente, string> = {
  tipo_pessoa: 'Tipo de pessoa',
  nome_razao_social: 'Nome',
  cpf_cnpj: 'CPF',
  telefone: 'Telefone',
  email: 'E-mail',
  cep: 'CEP',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
};

/** Cadastro (/clientes/novo) e edição (/clientes/:id/editar) de clientes. */
@Component({
  selector: 'app-cliente-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cliente-form.html',
  styleUrls: ['../compartilhado/pagina.css', './cliente-form.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClienteFormPage implements OnInit {
  private readonly clienteService = inject(ClienteService);
  private readonly router = inject(Router);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);

  /** Parâmetro de rota :id (ausente no cadastro). */
  readonly id = input<string>();
  /** Query param ?retorno=solicitacao: volta para a abertura de solicitação com o cliente escolhido. */
  readonly retorno = input<string>();
  readonly voltarParaSolicitacao = computed(() => this.retorno() === 'solicitacao' && !this.emEdicao());

  readonly ufs = UFS;
  readonly emEdicao = computed(() => this.id() !== undefined);
  readonly carregando = signal(false);
  readonly naoEncontrado = signal(false);
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly tentouEnviar = signal(false);
  readonly tipoPessoa = signal<TipoPessoa>('FISICA');

  readonly formulario = inject(NonNullableFormBuilder).group({
    tipo_pessoa: ['FISICA' as TipoPessoa, Validators.required],
    nome_razao_social: ['', [Validators.required, Validators.maxLength(200)]],
    cpf_cnpj: ['', [Validators.required, documentoValido]],
    telefone: ['', [Validators.required, quantidadeDigitos(10, 11)]],
    email: ['', [Validators.email, Validators.maxLength(150)]],
    cep: ['', [Validators.required, quantidadeDigitos(8, 8)]],
    logradouro: ['', [Validators.required, Validators.maxLength(150)]],
    numero: ['', [Validators.required, Validators.maxLength(10)]],
    complemento: ['', [Validators.maxLength(100)]],
    bairro: ['', [Validators.required, Validators.maxLength(100)]],
    cidade: ['', [Validators.required, Validators.maxLength(100)]],
    uf: ['', [Validators.required]],
  });

  constructor() {
    // Ao trocar o tipo de pessoa, reformata e revalida o documento
    this.formulario.controls.tipo_pessoa.valueChanges.subscribe((tipo) => {
      this.tipoPessoa.set(tipo);
      const documento = this.formulario.controls.cpf_cnpj;
      documento.setValue(formatarDocumento(documento.value, tipo));
      documento.updateValueAndValidity();
    });
  }

  ngOnInit(): void {
    if (this.emEdicao()) {
      this.carregarCliente();
    }
  }

  rotuloDocumento(): string {
    return this.tipoPessoa() === 'JURIDICA' ? 'CNPJ' : 'CPF';
  }

  rotuloNome(): string {
    return this.tipoPessoa() === 'JURIDICA' ? 'Razão social' : 'Nome completo';
  }

  /** Aplica a máscara enquanto o usuário digita. */
  mascarar(campo: 'cpf_cnpj' | 'telefone' | 'cep'): void {
    const controle = this.formulario.controls[campo];
    const formatado =
      campo === 'cpf_cnpj'
        ? formatarDocumento(controle.value, this.tipoPessoa())
        : campo === 'telefone'
          ? formatarTelefone(controle.value)
          : formatarCep(controle.value);
    if (formatado !== controle.value) {
      controle.setValue(formatado);
    }
  }

  /** Mensagem de validação do campo, exibida após tocar no campo ou tentar enviar. */
  mensagemCampo(campo: CampoCliente): string | null {
    const controle = this.formulario.controls[campo];
    if (!controle.invalid || !(controle.touched || this.tentouEnviar())) {
      return null;
    }
    const erros = controle.errors ?? {};
    const rotulo = campo === 'cpf_cnpj' ? this.rotuloDocumento() : ROTULOS[campo];

    if (erros['servidor']) return erros['servidor'] as string;
    if (erros['required']) return `Informe ${campo === 'uf' ? 'a UF' : `o campo ${rotulo}`}.`;
    if (erros['maxlength']) {
      return `${rotulo} deve ter no máximo ${(erros['maxlength'] as { requiredLength: number }).requiredLength} caracteres.`;
    }
    if (erros['documento']) return `${rotulo} deve conter ${erros['documento']} dígitos.`;
    if (erros['email']) return 'Informe um e-mail válido.';
    if (erros['digitos']) {
      return campo === 'cep' ? 'CEP deve conter 8 dígitos.' : 'Informe DDD e número (10 ou 11 dígitos).';
    }
    return `${rotulo} inválido.`;
  }

  salvar(): void {
    this.tentouEnviar.set(true);
    this.erro.set(null);

    if (this.formulario.invalid || this.enviando()) {
      this.formulario.markAllAsTouched();
      this.focarPrimeiroInvalido();
      return;
    }

    const valores = this.formulario.getRawValue();
    const dados: ClienteEntrada = {
      ...valores,
      nome_razao_social: valores.nome_razao_social.trim(),
      cpf_cnpj: somenteDigitos(valores.cpf_cnpj),
      telefone: somenteDigitos(valores.telefone),
      cep: somenteDigitos(valores.cep),
      email: valores.email.trim() || null,
      complemento: valores.complemento.trim() || null,
    };

    this.enviando.set(true);
    const id = Number(this.id());
    const requisicao = this.emEdicao()
      ? this.clienteService.atualizar(id, dados)
      : this.clienteService.criar(dados);

    requisicao.subscribe({
      next: (resposta) => {
        if (this.voltarParaSolicitacao()) {
          void this.router.navigate(['/solicitacoes/nova'], {
            queryParams: { cliente: resposta.cliente.id_cliente },
          });
          return;
        }
        void this.router.navigate(['/clientes', resposta.cliente.id_cliente], {
          queryParams: { aviso: this.emEdicao() ? 'atualizado' : 'cadastrado' },
        });
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        if (erro instanceof HttpErrorResponse && erro.status === 409) {
          // CPF/CNPJ já usado por outro cliente: mostra no próprio campo
          const documento = this.formulario.controls.cpf_cnpj;
          documento.setErrors({ servidor: mensagemDeErro(erro) });
          documento.markAsTouched();
          this.focarCampo('cpf_cnpj');
          return;
        }
        this.erro.set(mensagemDeErro(erro));
        this.elemento.nativeElement.querySelector<HTMLElement>('.aviso-erro')?.focus();
      },
    });
  }

  private carregarCliente(): void {
    const id = Number(this.id());
    if (!Number.isInteger(id) || id <= 0) {
      this.naoEncontrado.set(true);
      return;
    }

    this.carregando.set(true);
    this.clienteService.buscarPorId(id).subscribe({
      next: (cliente) => {
        this.formulario.controls.tipo_pessoa.setValue(cliente.tipo_pessoa);
        this.formulario.patchValue({
          nome_razao_social: cliente.nome_razao_social,
          cpf_cnpj: formatarDocumento(cliente.cpf_cnpj, cliente.tipo_pessoa),
          telefone: formatarTelefone(cliente.telefone),
          email: cliente.email ?? '',
          cep: formatarCep(cliente.cep),
          logradouro: cliente.logradouro,
          numero: cliente.numero,
          complemento: cliente.complemento ?? '',
          bairro: cliente.bairro,
          cidade: cliente.cidade,
          uf: cliente.uf,
        });
        this.carregando.set(false);
      },
      error: (erro: unknown) => {
        if (erro instanceof HttpErrorResponse && erro.status === 404) {
          this.naoEncontrado.set(true);
        } else {
          this.erro.set(mensagemDeErro(erro));
        }
        this.carregando.set(false);
      },
    });
  }

  private focarPrimeiroInvalido(): void {
    const campo = (Object.keys(this.formulario.controls) as CampoCliente[]).find(
      (nome) => this.formulario.controls[nome].invalid,
    );
    if (campo) {
      this.focarCampo(campo);
    }
  }

  private focarCampo(campo: CampoCliente): void {
    this.elemento.nativeElement.querySelector<HTMLElement>(`#campo-${campo}`)?.focus();
  }
}
