import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../config/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

// Agents guichet d'une compagnie, gérés par son company_admin (ou l'admin
// plateforme). Un agent = Utilisateur { role: 'agent' } rattaché à la compagnie.
@Controller('agents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AGENT_MANAGE)
export class AgentsController {
  constructor(private agentsService: AgentsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAgentDto,
  ) {
    return this.agentsService.create(dto, user);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') skip = 0,
    @Query('take') take = 20,
  ) {
    return this.agentsService.findAll(user, Number(skip), Number(take));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.agentsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agentsService.update(id, dto, user);
  }

  // Désactive le compte agent (il ne peut plus se connecter).
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.agentsService.delete(id, user);
  }
}
