import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { AuthService } from '../../app/auth/auth.service';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import {
  FiltrosOs,
  OrdemServicoResumo,
  STATUS_NAO_FINALIZADOS,
  STATUS_OS,
  StatusOs as CodigoStatus,
  UsuarioResumo,
} from '../../app/models/ordem-servico';
import { OrdemServicoService } from '../../app/services/ordem-servico.service';
import { UsuarioService } from '../../app/services/usuario.service';
import { formatarData } from '../../app/utils/formatacao-data';
import { StatusOs } from '../../components/status-os/status-os';

/** Valor do filtro de técnico: vazio (todos), "sem" (sem técnico) ou o ID. */
type FiltroTecnico = '' | 'sem' | `${number}`;

/** Valor do filtro de status: vazio (todos), um status ou as OS ainda não finalizadas. */
type FiltroStatus = CodigoStatus | '' | typeof NAO_FINALIZADAS;
const NAO_FINALIZADAS = 'NAO_FINALIZADAS';

/**
 * Página inicial: Ordens de Serviço com dados reais da API.
 * ADMINISTRADOR e ATENDENTE veem todas; o TÉCNICO vê só as atribuídas a ele
 * (o filtro é aplicado pelo backend).
 */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, StatusOs],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly ordemServicoService = inject(OrdemServicoService);
  private readonly usuarioService = inject(UsuarioService);
  private readonly buscas = new Subject<string>();

  readonly ehTecnico = computed(() => this.auth.perfil() === 'TECNICO');
  readonly formatarData = formatarData;

  /** Todas as OS visíveis ao usuário (base dos indicadores). */
  readonly todas = signal<OrdemServicoResumo[]>([]);
  /** OS da tabela, conforme os filtros. */
  readonly ordens = signal<OrdemServicoResumo[]>([]);
  readonly tecnicos = signal<UsuarioResumo[]>([]);
  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);

  readonly filtroStatus = signal<FiltroStatus>('');
  readonly naoFinalizadas = NAO_FINALIZADAS;
  readonly filtroTecnico = signal<FiltroTecnico>('');
  readonly busca = signal('');

  readonly status = STATUS_OS;
  readonly filtrosAtivos = computed(() => !!(this.filtroStatus() || this.filtroTecnico() || this.busca().trim()));

  readonly indicadores = computed(() => {
    const contagem = new Map<string, number>();
    for (const ordem of this.todas()) {
      contagem.set(ordem.status, (contagem.get(ordem.status) ?? 0) + 1);
    }
    return STATUS_OS.map((s) => ({ ...s, quantidade: contagem.get(s.codigo) ?? 0 }));
  });

  readonly semTecnico = computed(() => this.todas().filter((o) => o.id_tecnico === null).length);

  constructor() {
    this.buscas
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((termo) => {
        this.busca.set(termo);
        this.carregarTabela();
      });
  }

  ngOnInit(): void {
    this.atualizar();
    if (!this.ehTecnico()) {
      this.usuarioService.listarTecnicosAtivos().subscribe({
        next: (tecnicos) => this.tecnicos.set(tecnicos),
        error: () => this.tecnicos.set([]),
      });
    }
  }

  /** Recarrega indicadores e tabela. */
  atualizar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.ordemServicoService.listar().subscribe({
      next: (ordens) => {
        this.todas.set(ordens);
        if (this.filtrosAtivos()) {
          this.carregarTabela();
        } else {
          this.ordens.set(ordens);
          this.carregando.set(false);
        }
      },
      error: (erro: unknown) => {
        this.erro.set(mensagemDeErro(erro));
        this.carregando.set(false);
      },
    });
  }

  aoDigitarBusca(evento: Event): void {
    this.buscas.next((evento.target as HTMLInputElement).value.trim());
  }

  aoMudarStatus(evento: Event): void {
    this.filtroStatus.set((evento.target as HTMLSelectElement).value as FiltroStatus);
    this.carregarTabela();
  }

  aoMudarTecnico(evento: Event): void {
    this.filtroTecnico.set((evento.target as HTMLSelectElement).value as FiltroTecnico);
    this.carregarTabela();
  }

  /** Clique em um indicador: filtra a tabela por aquele status (ou limpa se já estiver filtrado). */
  filtrarPorStatus(codigo: CodigoStatus): void {
    this.filtroStatus.set(this.filtroStatus() === codigo ? '' : codigo);
    this.carregarTabela();
  }

  limparFiltros(): void {
    this.filtroStatus.set('');
    this.filtroTecnico.set('');
    this.busca.set('');
    this.buscas.next('');
    this.ordens.set(this.todas());
  }

  private carregarTabela(): void {
    if (!this.filtrosAtivos()) {
      this.ordens.set(this.todas());
      return;
    }

    const tecnico = this.filtroTecnico();
    const status = this.filtroStatus();
    const filtros: FiltrosOs = {
      // "Não finalizadas": todos os status exceto FINALIZADA e ENCERRADA_SEM_REPARO (filtrado pela API)
      status: status === NAO_FINALIZADAS ? STATUS_NAO_FINALIZADOS : status,
      busca: this.busca(),
      sem_tecnico: tecnico === 'sem',
      id_tecnico: tecnico && tecnico !== 'sem' ? Number(tecnico) : null,
    };

    this.carregando.set(true);
    this.erro.set(null);
    this.ordemServicoService.listar(filtros).subscribe({
      next: (ordens) => {
        this.ordens.set(ordens);
        this.carregando.set(false);
      },
      error: (erro: unknown) => {
        this.erro.set(mensagemDeErro(erro));
        this.carregando.set(false);
      },
    });
  }
}
