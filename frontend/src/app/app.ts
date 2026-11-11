import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppHeader } from '../components/layout/app-header/app-header';
import { TopNavigation } from '../components/layout/top-navigation/top-navigation';
import { AuthService } from './auth/auth.service';

@Component({
  selector: 'app-root',
  imports: [AppHeader, TopNavigation, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthService);

  protected readonly usuarioAutenticado = this.auth.usuario;

  protected sair(): void {
    this.auth.logout();
  }
}
